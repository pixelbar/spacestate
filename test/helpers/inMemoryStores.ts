import type { HistoryEntry, HistoryPage, HistoryQuery, HistoryStore } from "../../src/domain/history/types.js";
import type { CurrentStateSnapshot, CurrentStateStore } from "../../src/domain/state/types.js";

/**
 * Store doubles for tests that only care about HTTP-level behaviour and not
 * about Table Storage — they let a test build the real plugins with no
 * Azurite running, so those tests stay in the normal CI `check` job.
 */
export class InMemoryCurrentStateStore implements CurrentStateStore {
  snapshot: CurrentStateSnapshot | undefined;

  async get(): Promise<CurrentStateSnapshot | undefined> {
    return this.snapshot;
  }

  async set(snapshot: CurrentStateSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async clear(): Promise<void> {
    this.snapshot = undefined;
  }
}

export class InMemoryHistoryStore implements HistoryStore {
  /** Newest first, like the Table Storage implementation's query order. */
  entries: HistoryEntry[] = [];

  async append(entry: HistoryEntry): Promise<void> {
    this.entries.unshift(entry);
  }

  async mostRecent(): Promise<HistoryEntry | undefined> {
    return this.entries[0];
  }

  async query(query: HistoryQuery): Promise<HistoryPage> {
    return { items: this.entries.slice(0, query.limit) };
  }
}
