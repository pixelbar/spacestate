import * as Sentry from "@sentry/node";
import type { HistoryStore } from "../history/types.js";
import type {
  CurrentStateSnapshot,
  CurrentStateStore,
  SpaceState,
  StateChangeInput,
  StateChangeListener,
  StateChangeResult,
} from "./types.js";

const DEFAULT_STATE: SpaceState = "closed";

export class StateService {
  private readonly listeners: StateChangeListener[] = [];

  constructor(
    private readonly currentStateStore: CurrentStateStore,
    private readonly historyStore: HistoryStore,
  ) {}

  /**
   * Registers a callback run after every state change that was recorded (not
   * for no-ops). Listeners are fire-and-forget: they are not awaited, and one
   * that throws is reported without affecting the change or other listeners.
   */
  onChange(listener: StateChangeListener): void {
    this.listeners.push(listener);
  }

  async getCurrentState(): Promise<CurrentStateSnapshot> {
    try {
      return await this.resolveCurrentState();
    } catch (err) {
      Sentry.logger.error("StateService.getCurrentState failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async resolveCurrentState(): Promise<CurrentStateSnapshot> {
    const snapshot = await this.currentStateStore.get();
    if (snapshot) {
      Sentry.logger.debug("StateService.getCurrentState: served from pointer", { state: snapshot.state });
      return snapshot;
    }

    // The CurrentState pointer can lag a successful history write (no
    // cross-table transaction, see changeState below). Reconstruct from the
    // most recent history entry instead of assuming a default.
    const mostRecent = await this.historyStore.mostRecent();
    if (mostRecent) {
      Sentry.logger.info("StateService.getCurrentState: pointer missing, rebuilt from history", {
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

    Sentry.logger.info("StateService.getCurrentState: no state recorded, using default", {
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
    try {
      const result = await this.applyStateChange(input);
      Sentry.logger.info(
        result.changed ? "StateService.changeState: state changed" : "StateService.changeState: no-op, already in state",
        { state: input.state, user: input.user, source: input.source, changed: result.changed },
      );
      return result;
    } catch (err) {
      Sentry.logger.error("StateService.changeState failed", {
        state: input.state,
        user: input.user,
        source: input.source,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private async applyStateChange(input: StateChangeInput): Promise<StateChangeResult> {
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

    for (const listener of this.listeners) {
      try {
        listener({ snapshot, previousState: current.state });
      } catch (err) {
        Sentry.captureException(err);
      }
    }

    return { snapshot, changed: true };
  }
}
