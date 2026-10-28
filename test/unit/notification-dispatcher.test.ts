import { describe, expect, it, vi } from "vitest";
import type { StateChangedEvent } from "../../src/domain/state/types.js";
import { NotificationDispatcher } from "../../src/notifications/dispatcher.js";
import { DeliveryError, httpDeliveryError, type Delivery, type StateNotification, type Subscriber } from "../../src/notifications/types.js";

const opened: StateChangedEvent = {
  previousState: "closed",
  snapshot: { state: "open", changedAt: "2026-10-20T18:00:00.000Z", changedBy: "alice", method: "web", source: "api" },
};
const closed: StateChangedEvent = {
  previousState: "open",
  snapshot: { state: "closed", changedAt: "2026-10-20T22:00:00.000Z", changedBy: "bob", method: "button", source: "legacy" },
};

type Deliver = (notification: StateNotification, delivery: Delivery) => Promise<void>;

function subscriber(id: string, deliver: Deliver = async () => {}, timeoutMs?: number) {
  const calls: Array<{ notification: StateNotification; delivery: Delivery }> = [];
  const sub: Subscriber & { calls: typeof calls } = {
    id,
    timeoutMs,
    calls,
    deliver: async (notification, delivery) => {
      calls.push({ notification, delivery });
      return deliver(notification, delivery);
    },
  };
  return sub;
}

const sourceOf = (...subscribers: Subscriber[]) => ({ subscribers: () => subscribers });

describe("NotificationDispatcher", () => {
  it("hands every subscriber of every source the change", async () => {
    const a = subscriber("test:a");
    const b = subscriber("test:b");
    const dispatcher = new NotificationDispatcher([sourceOf(a), sourceOf(b)]);

    dispatcher.notify(opened);
    await dispatcher.idle();

    for (const sub of [a, b]) {
      expect(sub.calls).toHaveLength(1);
      expect(sub.calls[0]!.notification).toEqual({
        state: "open",
        previousState: "closed",
        changedAt: opened.snapshot.changedAt,
        changedBy: "alice",
        method: "web",
        source: "api",
      });
    }
    expect(a.calls[0]!.delivery.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.calls[0]!.delivery.id).not.toBe(b.calls[0]!.delivery.id);
  });

  it("returns before any subscriber answers", async () => {
    let release!: () => void;
    const slow = subscriber("test:slow", () => new Promise<void>((resolve) => (release = resolve)));
    const dispatcher = new NotificationDispatcher([sourceOf(slow)]);

    dispatcher.notify(opened); // would hang here if it awaited the subscriber
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    release();
    await dispatcher.idle();
  });

  it("retries with the same delivery id until it succeeds", async () => {
    const outcomes = [new Error("socket hang up"), new DeliveryError("HTTP 503", { retryable: true })];
    const flaky = subscriber("test:flaky", async () => {
      const next = outcomes.shift();
      if (next) throw next;
    });
    const dispatcher = new NotificationDispatcher([sourceOf(flaky)], { retryDelaysMs: [1, 1, 1] });

    dispatcher.notify(opened);
    await dispatcher.idle();

    expect(flaky.calls.map((c) => c.delivery.attempt)).toEqual([1, 2, 3]);
    expect(new Set(flaky.calls.map((c) => c.delivery.id)).size).toBe(1);
  });

  it("does not retry a non-retryable DeliveryError", async () => {
    const rejected = subscriber("test:rejected", async () => {
      throw new DeliveryError("HTTP 401", { retryable: false });
    });
    const dispatcher = new NotificationDispatcher([sourceOf(rejected)], { retryDelaysMs: [1, 1] });
    dispatcher.notify(opened);
    await dispatcher.idle();
    expect(rejected.calls).toHaveLength(1);
  });

  it("gives up after the last retry, without affecting other subscribers", async () => {
    const bad = subscriber("test:bad", async () => {
      throw new Error("down");
    });
    const good = subscriber("test:good");
    const dispatcher = new NotificationDispatcher([sourceOf(bad, good)], { retryDelaysMs: [1, 1] });
    dispatcher.notify(opened);
    await dispatcher.idle();
    expect(bad.calls).toHaveLength(3);
    expect(good.calls).toHaveLength(1);
  });

  it("times out an attempt even if the subscriber ignores its signal, and aborts the signal", async () => {
    const signals: AbortSignal[] = [];
    const hung = subscriber(
      "test:hung",
      (_n, delivery) => {
        signals.push(delivery.signal);
        return new Promise(() => {});
      },
      20,
    );
    const dispatcher = new NotificationDispatcher([sourceOf(hung)], { retryDelaysMs: [1] });
    dispatcher.notify(opened);
    await dispatcher.idle();
    expect(hung.calls).toHaveLength(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("delivers changes to one subscriber in order, even when the first needs retries", async () => {
    const delivered: string[] = [];
    let failFirst = true;
    const ordered = subscriber("test:ordered", async (notification) => {
      if (notification.state === "open" && failFirst) {
        failFirst = false;
        throw new Error("try again");
      }
      delivered.push(notification.state);
    });
    const dispatcher = new NotificationDispatcher([sourceOf(ordered)], { retryDelaysMs: [20] });

    dispatcher.notify(opened);
    dispatcher.notify(closed);
    await dispatcher.idle();

    expect(delivered).toEqual(["open", "closed"]);
  });

  it("does not hold one subscriber's queue behind another's", async () => {
    let release!: () => void;
    const slow = subscriber("test:slow", () => new Promise<void>((resolve) => (release = resolve)));
    const fast = subscriber("test:fast");
    const dispatcher = new NotificationDispatcher([sourceOf(slow, fast)]);

    dispatcher.notify(opened);
    dispatcher.notify(closed);
    await vi.waitFor(() => expect(fast.calls).toHaveLength(2));
    expect(slow.calls).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(slow.calls).toHaveLength(2));
    release();
    await dispatcher.idle();
  });

  it("asks sources for subscribers on every change", async () => {
    const subs: Subscriber[] = [];
    const dispatcher = new NotificationDispatcher([{ subscribers: () => subs }]);
    dispatcher.notify(opened);
    const late = subscriber("test:late");
    subs.push(late);
    dispatcher.notify(closed);
    await dispatcher.idle();
    expect(late.calls.map((c) => c.notification.state)).toEqual(["closed"]);
  });

  it("skips a source that throws and still notifies the others", async () => {
    const ok = subscriber("test:ok");
    const broken = {
      subscribers: (): Subscriber[] => {
        throw new Error("broken source");
      },
    };
    const dispatcher = new NotificationDispatcher([broken, sourceOf(ok)]);
    dispatcher.notify(opened);
    await dispatcher.idle();
    expect(ok.calls).toHaveLength(1);
  });

  it("stops retrying and drops queued changes once closed", async () => {
    const failing = subscriber("test:failing", async () => {
      throw new Error("down");
    });
    const dispatcher = new NotificationDispatcher([sourceOf(failing)], { retryDelaysMs: [60_000] });
    dispatcher.notify(opened);
    dispatcher.notify(closed);
    await vi.waitFor(() => expect(failing.calls).toHaveLength(1));

    await dispatcher.close(); // would take two minutes if it waited out the retries
    expect(failing.calls).toHaveLength(1);

    dispatcher.notify(opened);
    await dispatcher.idle();
    expect(failing.calls).toHaveLength(1);
  });
});

describe("httpDeliveryError", () => {
  it("accepts 2xx", () => {
    expect(httpDeliveryError(200)).toBeUndefined();
    expect(httpDeliveryError(204)).toBeUndefined();
  });

  it.each([408, 429, 500, 503])("retries HTTP %i", (status) => {
    expect(httpDeliveryError(status)?.retryable).toBe(true);
  });

  it.each([301, 400, 401, 403, 404, 422])("does not retry HTTP %i", (status) => {
    expect(httpDeliveryError(status)?.retryable).toBe(false);
  });

  it("includes the detail in the message", () => {
    expect(httpDeliveryError(422, "Validation failed")?.message).toBe("HTTP 422: Validation failed");
  });
});
