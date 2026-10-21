import { randomUUID } from "node:crypto";
import type { TableClient } from "@azure/data-tables";
import * as Sentry from "@sentry/node";
import { InvalidHistoryQueryError } from "../domain/history/types.js";
import type { HistoryEntry, HistoryPage, HistoryQuery, HistoryStore } from "../domain/history/types.js";

// 14 digits: safely beyond epoch-millis for the foreseeable future, used to
// invert the timestamp so RowKeys sort newest-first within a partition.
const INVERTED_MAX = 99_999_999_999_999;
// Empty partitions still cost a storage read. Bound work as well as results.
const MAX_PARTITION_READS = 12;

function monthPartitionKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

function invertedRowKey(iso: string): string {
  const epochMillis = new Date(iso).getTime();
  const inverted = (INVERTED_MAX - epochMillis).toString().padStart(14, "0");
  return `${inverted}-${randomUUID().slice(0, 8)}`;
}

// `monthIndex` is deliberately not bounds-checked by the caller (e.g.
// December of the previous year is expressed as monthIndex -1). Normalize
// arithmetically, including a year rollover, without
// Date's special treatment of years 0-99. Partition keys use UTC months.
function monthKeyAt(year: number, monthIndex: number): string {
  const normalizedYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  return `${String(normalizedYear).padStart(4, "0")}-${String(normalizedMonth + 1).padStart(2, "0")}`;
}

function monthNumber(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
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
 * resume: which month (as an offset from the newest month) and the inner
 * Table Storage continuation token within that month's partition. A page
 * may be empty but have a cursor when the partition-read budget is reached.
 */
interface QueryCursor {
  monthIndex: number;
  innerToken?: string;
}

function encodeCursor(cursor: QueryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function isValidInnerToken(token: unknown): boolean {
  if (token === undefined) return true;
  if (typeof token !== "string" || token.length === 0) return false;
  // The Azure Tables SDK emits base64 JSON with these continuation fields.
  // Validate before the SDK decodes it, so malformed cursors remain a 400.
  const parsed = JSON.parse(Buffer.from(token, "base64").toString("latin1"));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
    typeof parsed.nextPartitionKey === "string" && parsed.nextPartitionKey.length > 0 &&
    (parsed.nextRowKey === undefined || typeof parsed.nextRowKey === "string");
}

function decodeCursor(token: string | undefined, monthCount: number): QueryCursor {
  if (token === undefined) return { monthIndex: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      Number.isSafeInteger(parsed.monthIndex) && parsed.monthIndex >= 0 && parsed.monthIndex < monthCount &&
      isValidInnerToken(parsed.innerToken)
    ) return { monthIndex: parsed.monthIndex, innerToken: parsed.innerToken };
  } catch {
    // Invalid outer cursors must not reach the storage loop.
  }
  throw new InvalidHistoryQueryError("continuationToken", "Invalid history continuation token");
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
        const month = monthKeyAt(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo);
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
      const toDate = new Date(to);
      if (!Number.isFinite(toDate.getTime())) {
        throw new InvalidHistoryQueryError("to", "Invalid history end time");
      }
      const from = query.from ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const fromDate = new Date(from);
      if (!Number.isFinite(fromDate.getTime()) || fromDate > toDate) {
        throw new InvalidHistoryQueryError("from", "History start time must be at or before the end time");
      }
      const newestMonth = monthNumber(toDate);
      const monthCount = newestMonth - monthNumber(fromDate) + 1;
      const deviceFilter = query.device ? ` and deviceShortname eq '${escapeODataString(query.device)}'` : "";
      // changedAt is a fixed-width ISO-8601 UTC string, so lexicographic
      // comparison matches chronological order.
      const timeFilter = ` and changedAt ge '${from}' and changedAt le '${to}'`;
      const limit = query.limit ?? 50;

      const cursor = decodeCursor(query.continuationToken, monthCount);
      const items: HistoryEntry[] = [];
      let monthIndex = cursor.monthIndex;
      let innerToken = cursor.innerToken;
      let partitionReads = 0;

      while (monthIndex < monthCount && items.length < limit && partitionReads < MAX_PARTITION_READS) {
        const month = monthKeyAt(0, newestMonth - monthIndex);
        const filter = `PartitionKey eq '${month}'${deviceFilter}${timeFilter}`;
        partitionReads += 1;
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

      const hasMoreMonths = monthIndex < monthCount;
      return {
        items,
        continuationToken: hasMoreMonths ? encodeCursor({ monthIndex }) : undefined,
      };
    });
  }
}
