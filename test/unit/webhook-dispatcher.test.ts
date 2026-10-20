import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WebhookEntry } from "../../src/config/schema.js";
import type { StateChangedEvent } from "../../src/domain/state/types.js";
import { WebhookDispatcher, sign } from "../../src/domain/webhooks/dispatcher.js";
import type { WebhookRegistry } from "../../src/domain/webhooks/registry.js";

const DEV_POLICY = { allowInsecure: true, allowPrivate: true };

const hook = (id: string, url = `https://${id}.example/hook`): WebhookEntry => ({
  id,
  url,
  secret: `secret-for-${id}-0123456789`,
  createdAt: "2026-10-20T00:00:00.000Z",
  createdBy: "test",
});

const registryOf = (...hooks: WebhookEntry[]) => ({ list: () => hooks }) as unknown as WebhookRegistry;

const event: StateChangedEvent = {
  previousState: "closed",
  snapshot: { state: "open", changedAt: "2026-10-20T18:00:00.000Z", changedBy: "alice", method: "web", source: "api" },
};

const ok = () => new Response(null, { status: 204 });

describe("WebhookDispatcher", () => {
  it("posts the change as signed JSON to every webhook", async () => {
    const fetchMock = vi.fn(async () => ok());
    const a = hook("a");
    const dispatcher = new WebhookDispatcher(registryOf(a, hook("b")), { policy: DEV_POLICY, fetch: fetchMock });

    dispatcher.notify(event);
    await dispatcher.idle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === a.url)! as unknown as [string, RequestInit];
    expect(url).toBe(a.url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: "state.changed",
      state: "open",
      previousState: "closed",
      changedAt: event.snapshot.changedAt,
      changedBy: "alice",
      method: "web",
      source: "api",
    });
    expect(body.deliveryId).toMatch(/^[0-9a-f-]{36}$/);

    const headers = init.headers as Record<string, string>;
    const expected = createHmac("sha256", a.secret).update(`${headers["x-spacestate-timestamp"]}.${init.body}`).digest("hex");
    expect(headers["x-spacestate-signature"]).toBe(`sha256=${expected}`);
    expect(headers["x-spacestate-delivery"]).toBe(body.deliveryId);
  });

  it("notify returns before the receiver answers", async () => {
    let release!: () => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = () => resolve(ok()))));
    const dispatcher = new WebhookDispatcher(registryOf(hook("a")), { policy: DEV_POLICY, fetch: fetchMock });

    dispatcher.notify(event); // would hang here if it awaited the receiver
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    release();
    await dispatcher.idle();
  });

  it("retries 5xx with the same delivery id, then stops after success", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    const dispatcher = new WebhookDispatcher(registryOf(hook("a")), {
      policy: DEV_POLICY,
      fetch: fetchMock,
      retryDelaysMs: [1, 1, 1],
    });

    dispatcher.notify(event);
    await dispatcher.idle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const ids = fetchMock.mock.calls.map(([, init]) => (init as unknown as RequestInit & { headers: Record<string, string> }).headers["x-spacestate-delivery"]);
    expect(new Set(ids).size).toBe(1);
  });

  it.each([400, 404, 301])("does not retry HTTP %i", async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    const dispatcher = new WebhookDispatcher(registryOf(hook("a")), {
      policy: DEV_POLICY,
      fetch: fetchMock,
      retryDelaysMs: [1, 1],
    });
    dispatcher.notify(event);
    await dispatcher.idle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last retry, and one failing webhook does not affect another", async () => {
    const bad = hook("bad");
    const fetchMock = vi.fn(async (url: string) => (url === bad.url ? new Response(null, { status: 500 }) : ok()));
    const dispatcher = new WebhookDispatcher(registryOf(bad, hook("good")), {
      policy: DEV_POLICY,
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [1, 1],
    });
    dispatcher.notify(event);
    await dispatcher.idle();
    expect(fetchMock.mock.calls.filter(([u]) => u === bad.url)).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([u]) => u !== bad.url)).toHaveLength(1);
  });

  it("refuses to deliver to a host that resolves to a private address", async () => {
    const fetchMock = vi.fn(async () => ok());
    const dispatcher = new WebhookDispatcher(registryOf(hook("a", "https://localhost/hook")), {
      policy: { allowInsecure: false, allowPrivate: false },
      fetch: fetchMock,
      retryDelaysMs: [1],
    });
    dispatcher.notify(event);
    await dispatcher.idle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops retrying once closed", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    const dispatcher = new WebhookDispatcher(registryOf(hook("a")), {
      policy: DEV_POLICY,
      fetch: fetchMock,
      retryDelaysMs: [60_000],
    });
    dispatcher.notify(event);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await dispatcher.close(); // would take a minute if it waited out the retry
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sign", () => {
  it("covers the timestamp, so a captured body cannot be replayed with a fresh one", () => {
    expect(sign("s", "1", "{}")).not.toBe(sign("s", "2", "{}"));
  });
});
