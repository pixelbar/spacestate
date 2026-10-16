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

// `monthIndex` is deliberately not bounds-checked by the caller (e.g.
// December of the previous year is expressed as monthIndex -1) — the Date
// constructor normalizes any integer month into a real year/month, which is
// what correctly carries the year across a backward rollover.
function monthKeyAt(year: number, monthIndex: number): string {
  const normalized = new Date(year, monthIndex, 1);
  return `${normalized.getFullYear()}-${String(normalized.getMonth() + 1).padStart(2, "0")}`;
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

/**
 * Table Storage has no cross-partition ORDER BY, and a single multi-partition
 * query returns results in ascending PartitionKey order (oldest month first)
 * regardless of filter clause order. To get a genuinely newest-first result
 * across month boundaries, partitions are queried one at a time, newest
 * month first, stopping once `limit` is reached. This token tracks where to
 * resume: which month (by index into the newest-first month list) and the
 * inner Table Storage continuation token within that month's partition.
 */
interface QueryCursor {
  monthIndex: number;
  innerToken?: string;
}

function encodeCursor(cursor: QueryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(token: string | undefined): QueryCursor {
  if (!token) return { monthIndex: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (typeof parsed.monthIndex === "number") return parsed as QueryCursor;
  } catch {
    // Malformed/foreign token: restart from the newest month rather than erroring.
  }
  return { monthIndex: 0 };
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
      const months = monthsBetween(from, to).reverse(); // newest month first
      const deviceFilter = query.device ? ` and deviceShortname eq '${escapeODataString(query.device)}'` : "";
      // changedAt is a fixed-width ISO-8601 UTC string, so lexicographic
      // comparison matches chronological order.
      const timeFilter = ` and changedAt ge '${from}' and changedAt le '${to}'`;
      const limit = query.limit ?? 50;

      const cursor = decodeCursor(query.continuationToken);
      const items: HistoryEntry[] = [];
      let monthIndex = cursor.monthIndex;
      let innerToken = cursor.innerToken;

      while (monthIndex < months.length && items.length < limit) {
        const filter = `PartitionKey eq '${months[monthIndex]}'${deviceFilter}${timeFilter}`;
        const pageIterator = this.client
          .listEntities({ queryOptions: { filter } })
          .byPage({ maxPageSize: limit - items.length, continuationToken: innerToken });

        const { value: page, done } = await pageIterator.next();

        if (!done && page) {
          items.push(...page.map(toHistoryEntry));
          if (page.continuationToken) {
            // This month's partition has more entries than fit in `limit`.
            return { items, continuationToken: encodeCursor({ monthIndex, innerToken: page.continuationToken }) };
          }
        }

        monthIndex += 1;
        innerToken = undefined;
      }

      const hasMoreMonths = monthIndex < months.length;
      return {
        items,
        continuationToken: hasMoreMonths ? encodeCursor({ monthIndex }) : undefined,
      };
    });
  }
}
