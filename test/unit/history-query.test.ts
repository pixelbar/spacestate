import type { TableClient } from "@azure/data-tables";
import { describe, expect, it, vi } from "vitest";
import { TableHistoryStore } from "../../src/storage/historyTable.js";

function cursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeStore(pageFor: (filter: string, token?: string) => unknown[] = () => []) {
  const filters: string[] = [];
  const byPage = vi.fn();
  const listEntities = vi.fn(({ queryOptions: { filter } }) => {
    filters.push(filter);
    // Makes a regression fail quickly rather than issue an unbounded mock scan.
    if (filters.length > 12) throw new Error("partition-read budget exceeded");
    return {
      byPage: (options: { continuationToken?: string }) => {
        byPage(options);
        return { next: async () => ({ done: false, value: pageFor(filter, options.continuationToken) }) };
      },
    };
  });
  return { store: new TableHistoryStore({ listEntities } as unknown as TableClient), filters, byPage };
}

const range = { from: "2025-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.000Z" };

describe("history query work budget", () => {
  it("bounds a centuries-wide sparse query and returns a cursor", async () => {
    const { store, filters } = fakeStore();
    const page = await store.query({ from: "0100-01-01T00:00:00Z", to: "9999-12-31T23:59:59Z" });
    expect(filters).toHaveLength(12);
    expect(page.items).toEqual([]);
    expect(page.continuationToken).toBeDefined();
    expect(JSON.parse(Buffer.from(page.continuationToken!, "base64url").toString())).toEqual({ monthIndex: 12 });
  });

  it("resumes after an empty page without losing or reordering history", async () => {
    const record = { state: "open", user: "alice", method: "api", source: "api", changedAt: "2025-06-01T00:00:00.000Z" };
    const first = fakeStore();
    const firstPage = await first.store.query(range);
    expect(firstPage.items).toEqual([]);

    const second = fakeStore((filter) => filter.includes("PartitionKey eq '2025-06'") ? [record] : []);
    const secondPage = await second.store.query({ ...range, continuationToken: firstPage.continuationToken });
    expect(secondPage.items).toEqual([{ ...record, deviceShortname: undefined }]);
    expect(secondPage.continuationToken).toBeUndefined();
    expect([...first.filters, ...second.filters].map((filter) => filter.match(/PartitionKey eq '([^']+)'/)![1])).toEqual(
      Array.from({ length: 24 }, (_, index) => `${2026 - Math.floor(index / 12)}-${String(12 - index % 12).padStart(2, "0")}`),
    );
  });

  it("keeps an SDK continuation within the same monthly partition", async () => {
    const innerToken = Buffer.from(JSON.stringify({ nextPartitionKey: "2026-12", nextRowKey: "row" })).toString("base64");
    const first = fakeStore(() => Object.assign([], { continuationToken: innerToken }));
    const firstPage = await first.store.query(range);
    const next = fakeStore();
    await next.store.query({ ...range, continuationToken: firstPage.continuationToken });
    expect(next.filters[0]).toBe(first.filters[0]);
    expect(next.byPage.mock.calls[0]?.[0]).toMatchObject({ continuationToken: innerToken });
  });

  it.each([
    { monthIndex: -1_000_000_000 }, { monthIndex: -1 }, { monthIndex: 0.5 },
    { monthIndex: Number.MAX_SAFE_INTEGER + 1 }, { monthIndex: 24 },
    { monthIndex: "0" }, { monthIndex: null }, { monthIndex: 0, innerToken: {} }, null, [],
    { monthIndex: 0, innerToken: "not-json" }, { monthIndex: 0, innerToken: "" },
    { monthIndex: 0, innerToken: cursor(null) }, { monthIndex: 0, innerToken: cursor({ nextPartitionKey: 1 }) },
    { monthIndex: 0, innerToken: cursor({ nextPartitionKey: "month", nextRowKey: {} }) },
  ])("rejects unsafe cursor %j before reading storage", async (value) => {
    const { store, filters } = fakeStore();
    await expect(store.query({ ...range, continuationToken: cursor(value) })).rejects.toThrow("Invalid history continuation token");
    expect(filters).toEqual([]);
  });

  it.each(["", "not-json"])("rejects malformed cursor %j", async (continuationToken) => {
    const { store, filters } = fakeStore();
    await expect(store.query({ ...range, continuationToken })).rejects.toThrow("Invalid history continuation token");
    expect(filters).toEqual([]);
  });

  it("rejects a reversed date range before reading storage", async () => {
    const { store, filters } = fakeStore();
    await expect(store.query({ from: range.to, to: range.from })).rejects.toThrow("History start time");
    expect(filters).toEqual([]);
  });

  it("uses UTC partition keys, including years below 100", async () => {
    const { store, filters } = fakeStore();
    await store.query({ from: "0001-12-01T00:00:00Z", to: "0002-01-01T00:00:00Z" });
    expect(filters.map((filter) => filter.match(/PartitionKey eq '([^']+)'/)![1])).toEqual(["0002-01", "0001-12"]);
  });
});
