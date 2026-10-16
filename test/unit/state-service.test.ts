import { describe, expect, it } from "vitest";
import { StateService } from "../../src/domain/state/service.js";
import type { HistoryEntry, HistoryPage, HistoryQuery, HistoryStore } from "../../src/domain/history/types.js";
import type { CurrentStateSnapshot, CurrentStateStore } from "../../src/domain/state/types.js";

class FakeCurrentStateStore implements CurrentStateStore {
  snapshot: CurrentStateSnapshot | undefined;

  async get(): Promise<CurrentStateSnapshot | undefined> {
    return this.snapshot;
  }

  async set(snapshot: CurrentStateSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}

class FakeHistoryStore implements HistoryStore {
  entries: HistoryEntry[] = [];

  async append(entry: HistoryEntry): Promise<void> {
    this.entries.unshift(entry);
  }

  async mostRecent(): Promise<HistoryEntry | undefined> {
    return this.entries[0];
  }

  async query(_query: HistoryQuery): Promise<HistoryPage> {
    return { items: this.entries };
  }
}

describe("StateService", () => {
  it("defaults to closed when nothing has ever been recorded", async () => {
    const service = new StateService(new FakeCurrentStateStore(), new FakeHistoryStore());
    const snapshot = await service.getCurrentState();
    expect(snapshot.state).toBe("closed");
  });

  it("records a change and updates the current state pointer", async () => {
    const service = new StateService(new FakeCurrentStateStore(), new FakeHistoryStore());
    const result = await service.changeState({ state: "open", user: "alice", method: "api", source: "api" });

    expect(result.changed).toBe(true);
    expect(result.snapshot.state).toBe("open");
    expect((await service.getCurrentState()).state).toBe("open");
  });

  it("treats a repeat of the current state as a no-op", async () => {
    const service = new StateService(new FakeCurrentStateStore(), new FakeHistoryStore());
    await service.changeState({ state: "open", user: "alice", method: "api", source: "api" });
    const result = await service.changeState({ state: "open", user: "bob", method: "api", source: "api" });

    expect(result.changed).toBe(false);
    expect(result.snapshot.changedBy).toBe("alice");
  });

  it("falls back to history when the CurrentState pointer is missing", async () => {
    const currentStateStore = new FakeCurrentStateStore();
    const historyStore = new FakeHistoryStore();
    historyStore.entries.push({
      state: "open",
      user: "alice",
      method: "api",
      source: "api",
      changedAt: new Date().toISOString(),
    });

    const service = new StateService(currentStateStore, historyStore);
    expect((await service.getCurrentState()).state).toBe("open");
  });
});
