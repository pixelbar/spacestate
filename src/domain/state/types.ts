export type SpaceState = "open" | "closed";
export type ChangeSource = "api" | "legacy";

export interface StateChangeInput {
  state: SpaceState;
  user: string;
  method: string;
  source: ChangeSource;
  deviceShortname?: string;
}

export interface CurrentStateSnapshot {
  state: SpaceState;
  changedAt: string; // ISO timestamp
  changedBy: string;
  method: string;
  source: ChangeSource;
}

export interface StateChangeResult {
  snapshot: CurrentStateSnapshot;
  /** false if the request was a no-op (already in the requested state) */
  changed: boolean;
}

/** A change that was recorded (never a no-op), as passed to `StateService.onChange` listeners. */
export interface StateChangedEvent {
  snapshot: CurrentStateSnapshot;
  previousState: SpaceState;
}

export type StateChangeListener = (event: StateChangedEvent) => void;

/**
 * Fast-path pointer to the current state. Not the source of truth on its
 * own — see domain/history for that — but a point read here is O(1) and
 * strongly consistent, which is what the frequently-polled state endpoints
 * need.
 */
export interface CurrentStateStore {
  get(): Promise<CurrentStateSnapshot | undefined>;
  set(snapshot: CurrentStateSnapshot): Promise<void>;
  /**
   * Removes the pointer, if present. Used to recover from a failed `set`:
   * a failed write can leave a *stale* (not missing) row behind, which
   * `get()` can't tell apart from a fresh one — clearing it is what makes
   * the "missing -> fall back to history" path in getCurrentState() apply.
   */
  clear(): Promise<void>;
}
