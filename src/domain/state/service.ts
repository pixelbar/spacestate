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
  constructor(
    private readonly currentStateStore: CurrentStateStore,
    private readonly historyStore: HistoryStore,
  ) {}

  async getCurrentState(): Promise<CurrentStateSnapshot> {
    const snapshot = await this.currentStateStore.get();
    if (snapshot) return snapshot;

    // The CurrentState pointer can lag a successful history write (no
    // cross-table transaction, see changeState below). Reconstruct from the
    // most recent history entry instead of assuming a default.
    const mostRecent = await this.historyStore.mostRecent();
    if (mostRecent) {
      return {
        state: mostRecent.state,
        changedAt: mostRecent.changedAt,
        changedBy: mostRecent.user,
        method: mostRecent.method,
        source: mostRecent.source,
      };
    }

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
