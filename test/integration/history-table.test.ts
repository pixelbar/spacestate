import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../../src/domain/history/types.js";
import { TableHistoryStore } from "../../src/storage/historyTable.js";
import { createTableClients } from "../../src/storage/tableClients.js";
import { applyAzuriteEnv, resetTestTables } from "../helpers/azurite.js";

let store: TableHistoryStore;

function entry(changedAt: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { state: "open", user: "alice", method: "api", source: "api", changedAt, ...overrides };
}

beforeAll(async () => {
  applyAzuriteEnv();
  await resetTestTables();
  store = new TableHistoryStore(createTableClients().stateHistory);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TableHistoryStore.mostRecent across a year boundary", () => {
  beforeEach(async () => {
    await resetTestTables();
    store = new TableHistoryStore(createTableClients().stateHistory);
  });

  it("finds December's entry when 'now' is early January (sentry[bot] finding)", async () => {
    await store.append(entry("2025-12-30T10:00:00.000Z", { method: "december-entry" }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:00:00.000Z"));

    const mostRecent = await store.mostRecent();
    expect(mostRecent?.method).toBe("december-entry");
  });
});

describe("TableHistoryStore.query", () => {
  beforeEach(async () => {
    await resetTestTables();
    store = new TableHistoryStore(createTableClients().stateHistory);
  });

  it("excludes entries outside an exact from/to window within one month", async () => {
    await store.append(entry("2025-06-01T00:00:00.000Z", { method: "too-early" }));
    await store.append(entry("2025-06-15T00:00:00.000Z", { method: "in-range" }));
    await store.append(entry("2025-06-30T23:59:59.000Z", { method: "too-late" }));

    const page = await store.query({ from: "2025-06-10T00:00:00.000Z", to: "2025-06-20T00:00:00.000Z" });

    expect(page.items.map((i) => i.method)).toEqual(["in-range"]);
  });

  it("returns results newest-first across a month boundary, not oldest-partition-first", async () => {
    await store.append(entry("2025-11-15T00:00:00.000Z", { method: "november" }));
    await store.append(entry("2025-12-15T00:00:00.000Z", { method: "december" }));

    const page = await store.query({ from: "2025-11-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z" });

    expect(page.items.map((i) => i.method)).toEqual(["december", "november"]);
  });

  it("paginates across a month boundary via continuationToken without losing or reordering entries", async () => {
    await store.append(entry("2025-11-10T00:00:00.000Z", { method: "nov-1" }));
    await store.append(entry("2025-11-20T00:00:00.000Z", { method: "nov-2" }));
    await store.append(entry("2025-12-10T00:00:00.000Z", { method: "dec-1" }));

    const range = { from: "2025-11-01T00:00:00.000Z", to: "2025-12-31T23:59:59.000Z" };

    const firstPage = await store.query({ ...range, limit: 1 });
    expect(firstPage.items.map((i) => i.method)).toEqual(["dec-1"]);
    expect(firstPage.continuationToken).toBeDefined();

    const secondPage = await store.query({ ...range, limit: 1, continuationToken: firstPage.continuationToken });
    expect(secondPage.items.map((i) => i.method)).toEqual(["nov-2"]);
    expect(secondPage.continuationToken).toBeDefined();

    const thirdPage = await store.query({ ...range, limit: 1, continuationToken: secondPage.continuationToken });
    expect(thirdPage.items.map((i) => i.method)).toEqual(["nov-1"]);
    expect(thirdPage.continuationToken).toBeUndefined();
  });

  it("filters by device across months", async () => {
    await store.append(entry("2025-11-15T00:00:00.000Z", { method: "nov", deviceShortname: "button-a" }));
    await store.append(entry("2025-12-15T00:00:00.000Z", { method: "dec", deviceShortname: "button-b" }));

    const page = await store.query({
      from: "2025-11-01T00:00:00.000Z",
      to: "2025-12-31T23:59:59.000Z",
      device: "button-a",
    });

    expect(page.items.map((i) => i.method)).toEqual(["nov"]);
  });
});
