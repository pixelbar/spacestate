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

/**
 * Fast-path pointer to the current state. Not the source of truth on its
 * own — see domain/history for that — but a point read here is O(1) and
 * strongly consistent, which is what the frequently-polled state endpoints
 * need.
 */
export interface CurrentStateStore {
  get(): Promise<CurrentStateSnapshot | undefined>;
  set(snapshot: CurrentStateSnapshot): Promise<void>;
}
