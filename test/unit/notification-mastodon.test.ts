import { describe, expect, it, vi } from "vitest";
import { notificationsConfigSchema } from "../../src/notifications/config.js";
import { ConfiguredChannels } from "../../src/notifications/configuredChannels.js";
import { NotificationDispatcher } from "../../src/notifications/dispatcher.js";
import type { Delivery, StateNotification } from "../../src/notifications/types.js";

const notification: StateNotification = {
  state: "open",
  previousState: "closed",
  changedAt: "2026-10-20T18:00:00.000Z",
  changedBy: "alice",
  method: "web",
  source: "api",
};

const entry = {
  type: "mastodon",
  id: "pixelbar",
  instance: "https://mastodon.example/",
  accessToken: "token-123",
};

function mastodonWith(fetchMock: typeof fetch, overrides: Record<string, unknown> = {}) {
  const config = notificationsConfigSchema.parse({ channels: [{ ...entry, ...overrides }] });
  const channels = new ConfiguredChannels({ get: () => config }, { space: () => "Pixelbar", fetch: fetchMock });
  return { channels, subscriber: channels.subscribers()[0]! };
}

const delivery = (id = "delivery-1"): Delivery => ({ id, attempt: 1, signal: new AbortController().signal });
const created = () => new Response(JSON.stringify({ id: "1" }), { status: 200 });

describe("mastodon channel", () => {
  it("posts the message as a status, with an idempotency key", async () => {
    const fetchMock = vi.fn(async () => created());
    const { subscriber } = mastodonWith(fetchMock as unknown as typeof fetch, { language: "nl", visibility: "unlisted" });

    expect(subscriber.id).toBe("mastodon:pixelbar");
    await subscriber.deliver(notification, delivery("abc"));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://mastodon.example/api/v1/statuses");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer token-123");
    expect(init.headers["idempotency-key"]).toBe("abc");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body as string)).toEqual({ status: "Pixelbar is open.", visibility: "unlisted", language: "nl" });
  });

  it("defaults to public and leaves the language to the instance", async () => {
    const fetchMock = vi.fn(async () => created());
    await mastodonWith(fetchMock as unknown as typeof fetch).subscriber.deliver(notification, delivery());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ status: "Pixelbar is open.", visibility: "public" });
  });

  it("fails for good on a rejected token, quoting Mastodon's reason", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "The access token is invalid" }), { status: 401 }));
    await expect(mastodonWith(fetchMock as unknown as typeof fetch).subscriber.deliver(notification, delivery())).rejects.toMatchObject({
      retryable: false,
      message: "HTTP 401: The access token is invalid",
    });
  });

  it("retries a server error with the same idempotency key", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(created());
    const { channels } = mastodonWith(fetchMock as unknown as typeof fetch);
    const dispatcher = new NotificationDispatcher([channels], { retryDelaysMs: [1] });

    dispatcher.notify({
      previousState: "closed",
      snapshot: { state: "open", changedAt: notification.changedAt, changedBy: "alice", method: "web", source: "api" },
    });
    await dispatcher.idle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(
      (call) => (call as unknown as [string, { headers: Record<string, string> }])[1].headers["idempotency-key"],
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("validates its config", () => {
    const issues = (overrides: Record<string, unknown>) => {
      const result = notificationsConfigSchema.safeParse({ channels: [{ ...entry, ...overrides }] });
      return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    };
    expect(issues({})).toEqual([]);
    expect(issues({ instance: "http://mastodon.example" })).toEqual(["channels.0.instance"]);
    expect(issues({ accessToken: "" })).toEqual(["channels.0.accessToken"]);
    expect(issues({ visibility: "everyone" })).toEqual(["channels.0.visibility"]);
    expect(issues({ language: "Dutch" })).toEqual(["channels.0.language"]);
  });
});
