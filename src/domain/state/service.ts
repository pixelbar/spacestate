import * as Sentry from "@sentry/node";
import type { HistoryStore } from "../history/types.js";
import type {
  CurrentStateSnapshot,
  CurrentStateStore,
  SpaceState,
  StateChangeInput,
  StateChangeResult,
} from "./types.js";

const DEFAULT_STATE: SpaceState = "closed";

export class StateService {
  /** The fallback the last read used, so each is reported once rather than on every poll. */
  private fallback: "history" | "default" | undefined;

  constructor(
    private readonly currentStateStore: CurrentStateStore,
    private readonly historyStore: HistoryStore,
  ) {}

  // Every poll reads the state, so a normal read logs at debug and a
  // fallback is reported when it starts. Failures propagate to the route,
  // where the error handler logs and captures them, and state changes are
  // logged by the route that made them, with who made them.

  async getCurrentState(): Promise<CurrentStateSnapshot> {
    const snapshot = await this.currentStateStore.get();
    if (snapshot) {
      this.fallback = undefined;
      Sentry.logger.debug("StateService.getCurrentState: served from pointer", { state: snapshot.state });
      return snapshot;
    }

    // The CurrentState pointer can lag a successful history write (no
    // cross-table transaction, see changeState below). Reconstruct from the
    // most recent history entry instead of assuming a default.
    const mostRecent = await this.historyStore.mostRecent();
    if (mostRecent) {
      const level = this.fallback === "history" ? "debug" : "warn";
      this.fallback = "history";
      Sentry.logger[level]("StateService.getCurrentState: pointer missing, rebuilt from history", {
        state: mostRecent.state,
      });
      return {
        state: mostRecent.state,
        changedAt: mostRecent.changedAt,
        changedBy: mostRecent.user,
        method: mostRecent.method,
        source: mostRecent.source,
      };
    }

    const level = this.fallback === "default" ? "debug" : "info";
    this.fallback = "default";
    Sentry.logger[level]("StateService.getCurrentState: no state recorded, using default", {
      state: DEFAULT_STATE,
    });
    return {
      state: DEFAULT_STATE,
      changedAt: new Date(0).toISOString(),
      changedBy: "system",
      method: "default",
      source: "api",
    };
  }

  async changeState(input: StateChangeInput): Promise<StateChangeResult> {
    const current = await this.getCurrentState();
    if (current.state === input.state) {
      return { snapshot: current, changed: false };
    }

    const changedAt = new Date().toISOString();
    const snapshot: CurrentStateSnapshot = {
      state: input.state,
      changedAt,
      changedBy: input.user,
      method: input.method,
      source: input.source,
    };

    // History is the source of truth; write it first.
    await this.historyStore.append({
      state: input.state,
      user: input.user,
      method: input.method,
      deviceShortname: input.deviceShortname,
      source: input.source,
      changedAt,
    });

    try {
      await this.currentStateStore.set(snapshot);
    } catch (err) {
      // Not fatal: the history write already succeeded. But a failed `set`
      // can leave a *stale* pointer behind (if one existed from a previous
      // write) rather than a missing one, and getCurrentState() only falls
      // back to history when the pointer is missing — so a stale row would
      // otherwise keep being served as-is, forever. Clear it (best-effort)
      // so that fallback path actually applies on the next read.
      Sentry.logger.warn(
        "Failed to update the CurrentState pointer after a successful history write; clearing it so reads fall back to a history scan",
        { error: err instanceof Error ? err.message : String(err) },
      );
      Sentry.captureException(err);

      try {
        await this.currentStateStore.clear();
      } catch (clearErr) {
        Sentry.captureException(clearErr);
      }
    }

    return { snapshot, changed: true };
  }
}
