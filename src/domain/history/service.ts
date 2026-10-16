import type { HistoryPage, HistoryQuery, HistoryStore } from "./types.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class HistoryService {
  constructor(private readonly store: HistoryStore) {}

  async query(query: HistoryQuery): Promise<HistoryPage> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return this.store.query({ ...query, limit });
  }
}
