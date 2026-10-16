import { randomUUID } from "node:crypto";
import type { TableClient } from "@azure/data-tables";
import * as Sentry from "@sentry/node";
import type { HistoryEntry, HistoryPage, HistoryQuery, HistoryStore } from "../domain/history/types.js";

// 14 digits: safely beyond epoch-millis for the foreseeable future, used to
// invert the timestamp so RowKeys sort newest-first within a partition.
const INVERTED_MAX = 99_999_999_999_999;

function monthPartitionKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

function invertedRowKey(iso: string): string {
  const epochMillis = new Date(iso).getTime();
  const inverted = (INVERTED_MAX - epochMillis).toString().padStart(14, "0");
  return `${inverted}-${randomUUID().slice(0, 8)}`;
}

function monthKeyAt(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** Inclusive list of "YYYY-MM" partition keys between two ISO timestamps. */
function monthsBetween(fromIso: string, toIso: string): string[] {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const months: string[] = [];
  let year = from.getFullYear();
  let monthIndex = from.getMonth();
  while (year < to.getFullYear() || (year === to.getFullYear() && monthIndex <= to.getMonth())) {
    months.push(monthKeyAt(year, monthIndex));
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }
  return months;
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

function toHistoryEntry(entity: Record<string, unknown>): HistoryEntry {
  return {
    state: entity.state as HistoryEntry["state"],
    user: entity.user as string,
    method: entity.method as string,
    deviceShortname: (entity.deviceShortname as string) || undefined,
    source: entity.source as HistoryEntry["source"],
    changedAt: entity.changedAt as string,
  };
}

export class TableHistoryStore implements HistoryStore {
  constructor(private readonly client: TableClient) {}

  async append(entry: HistoryEntry): Promise<void> {
    await Sentry.startSpan({ name: "StateHistory.append", op: "db.table.insert" }, async () => {
      await this.client.createEntity({
        partitionKey: monthPartitionKey(entry.changedAt),
        rowKey: invertedRowKey(entry.changedAt),
        state: entry.state,
        user: entry.user,
        method: entry.method,
        deviceShortname: entry.deviceShortname ?? "",
        source: entry.source,
        changedAt: entry.changedAt,
      });
    });
  }

  async mostRecent(): Promise<HistoryEntry | undefined> {
    return Sentry.startSpan({ name: "StateHistory.mostRecent", op: "db.table.query" }, async () => {
      const now = new Date();
      // Try the current month, then fall back one month to cover the first
      // few days after a month rollover with no new entries yet.
      for (const monthsAgo of [0, 1]) {
        const month = monthKeyAt(now.getFullYear(), now.getMonth() - monthsAgo);
        const iter = this.client.listEntities({ queryOptions: { filter: `PartitionKey eq '${month}'` } });
        for await (const entity of iter) {
          return toHistoryEntry(entity);
        }
      }
      return undefined;
    });
  }

  async query(query: HistoryQuery): Promise<HistoryPage> {
    return Sentry.startSpan({ name: "StateHistory.query", op: "db.table.query" }, async () => {
      const to = query.to ?? new Date().toISOString();
      const from = query.from ?? new Date(new Date(to).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const months = monthsBetween(from, to).reverse(); // newest-first, matches RowKey ordering
      const partitionFilter = months.map((m) => `PartitionKey eq '${m}'`).join(" or ");
      const deviceFilter = query.device ? ` and deviceShortname eq '${escapeODataString(query.device)}'` : "";
      const limit = query.limit ?? 50;

      const pages = this.client
        .listEntities({ queryOptions: { filter: `(${partitionFilter})${deviceFilter}` } })
        .byPage({ maxPageSize: limit, continuationToken: query.continuationToken });

      const { value: page, done } = await pages.next();
      if (done || !page) {
        return { items: [] };
      }

      return { items: page.map(toHistoryEntry), continuationToken: page.continuationToken };
    });
  }
}
