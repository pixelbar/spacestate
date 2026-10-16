import type { ChangeSource, SpaceState } from "../state/types.js";

export interface HistoryEntry {
  state: SpaceState;
  user: string;
  method: string;
  deviceShortname?: string;
  source: ChangeSource;
  changedAt: string; // ISO timestamp
}

export interface HistoryQuery {
  from?: string;
  to?: string;
  device?: string;
  limit?: number;
  continuationToken?: string;
}

export interface HistoryPage {
  items: HistoryEntry[];
  continuationToken?: string;
}

/**
 * Append-only log of state changes. `mostRecent` exists specifically as a
 * reconciliation path for CurrentStateStore (see domain/state/service.ts) —
 * it is not the default way to answer "what's the current state".
 */
export interface HistoryStore {
  append(entry: HistoryEntry): Promise<void>;
  query(query: HistoryQuery): Promise<HistoryPage>;
  mostRecent(): Promise<HistoryEntry | undefined>;
}
