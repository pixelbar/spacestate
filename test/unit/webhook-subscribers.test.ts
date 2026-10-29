import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WebhookEntry } from "../../src/config/schema.js";
import type { StateChangedEvent } from "../../src/domain/state/types.js";
import { NotificationDispatcher } from "../../src/notifications/dispatcher.js";
import { sign, WEBHOOK_TIMEOUT_MS, WebhookSubscribers } from "../../src/notifications/webhooks/subscribers.js";

const DEV_POLICY = { allowInsecure: true, allowPrivate: true };

const hook = (id: string, url = `https://${id}.example/hook`): WebhookEntry => ({
  id,
  url,
  secret: `secret-for-${id}-0123456789`,
  createdAt: "2026-10-20T00:00:00.000Z",
  createdBy: "test",
});

const registryOf = (...hooks: WebhookEntry[]) => ({ list: () => hooks });

const event: StateChangedEvent = {
  previousState: "closed",
  snapshot: { state: "open", changedAt: "2026-10-20T18:00:00.000Z", changedBy: "alice", method: "web", source: "api" },
};

const ok = () => new Response(null, { status: 204 });
type Fetch = (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>;
const asFetch = (mock: Fetch) => mock as unknown as typeof fetch;

/** Webhooks as they run in the app: through the shared dispatcher, with fast retries. */
function dispatcherFor(
  webhooks: WebhookSubscribers,
  retryDelaysMs = [1, 1, 1],
): NotificationDispatcher {
  return new NotificationDispatcher([webhooks], { retryDelaysMs });
}

describe("WebhookSubscribers", () => {
  it("names each webhook's subscriber after its id, with the documented timeout", () => {
    const subscribers = new WebhookSubscribers(registryOf(hook("a"), hook("b")), { policy: DEV_POLICY }).subscribers();
    expect(subscribers.map((s) => s.id)).toEqual(["webhook:a", "webhook:b"]);
    expect(subscribers.every((s) => s.timeoutMs === WEBHOOK_TIMEOUT_MS)).toBe(true);
  });

  it("posts the change as signed JSON to every webhook", async () => {
    const fetchMock = vi.fn<Fetch>(async () => ok());
    const a = hook("a");
    const dispatcher = dispatcherFor(new WebhookSubscribers(registryOf(a, hook("b")), { policy: DEV_POLICY, fetch: asFetch(fetchMock) }));

    dispatcher.notify(event);
    await dispatcher.idle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === a.url)!;
    expect(url).toBe(a.url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      event: "state.changed",
      deliveryId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      state: "open",
      previousState: "closed",
      changedAt: event.snapshot.changedAt,
      changedBy: "alice",
      method: "web",
      source: "api",
    });

    const headers = init.headers;
    const expected = createHmac("sha256", a.secret).update(`${headers["x-spacestate-timestamp"]}.${init.body}`).digest("hex");
    expect(headers["x-spacestate-signature"]).toBe(`sha256=${expected}`);
    expect(headers["x-spacestate-delivery"]).toBe(body.deliveryId);
    expect(headers["x-spacestate-event"]).toBe("state.changed");
  });

  it("retries 5xx and network errors with the same delivery id, then stops after success", async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    const dispatcher = dispatcherFor(new WebhookSubscribers(registryOf(hook("a")), { policy: DEV_POLICY, fetch: asFetch(fetchMock) }));

    dispatcher.notify(event);
    await dispatcher.idle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const ids = fetchMock.mock.calls.map(([, init]) => init.headers["x-spacestate-delivery"]);
    expect(new Set(ids).size).toBe(1);
  });

  it.each([400, 404, 301])("does not retry HTTP %i", async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    const dispatcher = dispatcherFor(new WebhookSubscribers(registryOf(hook("a")), { policy: DEV_POLICY, fetch: fetchMock }));
    dispatcher.notify(event);
    await dispatcher.idle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last retry, and one failing webhook does not affect another", async () => {
    const bad = hook("bad");
    const fetchMock = vi.fn(async (url: string) => (url === bad.url ? new Response(null, { status: 500 }) : ok()));
    const dispatcher = dispatcherFor(
      new WebhookSubscribers(registryOf(bad, hook("good")), { policy: DEV_POLICY, fetch: fetchMock as unknown as typeof fetch }),
      [1, 1],
    );
    dispatcher.notify(event);
    await dispatcher.idle();
    expect(fetchMock.mock.calls.filter(([u]) => u === bad.url)).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([u]) => u !== bad.url)).toHaveLength(1);
  });

  it("refuses, once and for all, to deliver to a host that resolves to a private address", async () => {
    const fetchMock = vi.fn(async () => ok());
    const subscriber = new WebhookSubscribers(registryOf(hook("a", "https://localhost/hook")), {
      policy: { allowInsecure: false, allowPrivate: false },
      fetch: fetchMock,
    }).subscribers()[0]!;

    await expect(
      subscriber.deliver(
        { state: "open", previousState: "closed", changedAt: "", changedBy: "", method: "", source: "api" },
        { id: "d", attempt: 1, signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ name: "DeliveryError", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers successive changes to one webhook in order", async () => {
    const states: string[] = [];
    let first = true;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (first) {
        first = false;
        return new Response(null, { status: 503 });
      }
      states.push(JSON.parse(init.body as string).state);
      return ok();
    });
    const dispatcher = dispatcherFor(
      new WebhookSubscribers(registryOf(hook("a")), { policy: DEV_POLICY, fetch: fetchMock as unknown as typeof fetch }),
      [20],
    );
    dispatcher.notify(event);
    dispatcher.notify({ previousState: "open", snapshot: { ...event.snapshot, state: "closed" } });
    await dispatcher.idle();
    expect(states).toEqual(["open", "closed"]);
  });
});

describe("sign", () => {
  it("covers the timestamp, so a captured body cannot be replayed with a fresh one", () => {
    expect(sign("s", "1", "{}")).not.toBe(sign("s", "2", "{}"));
  });
});
