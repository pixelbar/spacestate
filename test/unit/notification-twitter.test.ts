import { describe, expect, it, vi } from "vitest";
import { oauth1Header, percentEncode } from "../../src/notifications/channels/oauth1.js";
import { notificationsConfigSchema } from "../../src/notifications/config.js";
import { ConfiguredChannels } from "../../src/notifications/configuredChannels.js";
import type { Delivery, StateNotification } from "../../src/notifications/types.js";

describe("oauth1Header", () => {
  // The worked example from X's "Creating a signature" documentation.
  const credentials = {
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  };

  it("matches X's documented signature, signing query and form parameters", () => {
    const header = oauth1Header("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true", credentials, {
      params: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      timestamp: 1318622958,
    });
    expect(header).toBe(
      'OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", ' +
        'oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", ' +
        'oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D", ' +
        'oauth_signature_method="HMAC-SHA1", ' +
        'oauth_timestamp="1318622958", ' +
        'oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", ' +
        'oauth_version="1.0"',
    );
  });

  it("uses a fresh nonce each time", () => {
    const url = "https://api.x.com/2/tweets";
    expect(oauth1Header("POST", url, credentials)).not.toBe(oauth1Header("POST", url, credentials));
  });

  it("percent-encodes the characters encodeURIComponent leaves alone", () => {
    expect(percentEncode("a!b*c'd(e)f ~")).toBe("a%21b%2Ac%27d%28e%29f%20~");
  });
});

describe("twitter channel", () => {
  const entry = {
    type: "twitter",
    id: "pixelbar-x",
    consumerKey: "ck",
    consumerSecret: "cs",
    accessToken: "at",
    accessTokenSecret: "ats",
  };
  const notification: StateNotification = {
    state: "closed",
    previousState: "open",
    changedAt: "2026-10-20T21:42:00.000Z",
    changedBy: "alice",
    method: "web",
    source: "api",
  };
  const delivery: Delivery = { id: "d", attempt: 1, signal: new AbortController().signal };

  function subscriberWith(fetchMock: typeof fetch, document: Record<string, unknown> = {}) {
    const config = notificationsConfigSchema.parse({ ...document, channels: [{ ...entry, ...(document.channel as object) }] });
    return new ConfiguredChannels({ get: () => config }, { space: () => "Pixelbar", fetch: fetchMock }).subscribers()[0]!;
  }

  it("posts the text with an OAuth 1.0a signature, and the time in the default message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: "1" } }), { status: 201 }));
    const subscriber = subscriberWith(fetchMock as unknown as typeof fetch);
    expect(subscriber.id).toBe("twitter:pixelbar-x");

    await subscriber.deliver(notification, delivery);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.x.com/2/tweets");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toMatch(/^OAuth oauth_consumer_key="ck", .*oauth_signature="[^"]+", .*oauth_token="at"/);
    // 21:42 UTC is 23:42 in Amsterdam summer time.
    expect(JSON.parse(init.body as string)).toEqual({ text: "Pixelbar closed at 23:42." });
  });

  it("lets the document's messages override its defaults", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    await subscriberWith(fetchMock as unknown as typeof fetch, { messages: { closed: "{space} dicht ({date} {time})" } }).deliver(
      notification,
      delivery,
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ text: "Pixelbar dicht (2026-10-20 23:42)" });
  });

  it("does not retry a duplicate, and says why", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ title: "Forbidden", detail: "You are not allowed to create a Tweet with duplicate content." }), {
          status: 403,
        }),
    );
    await expect(subscriberWith(fetchMock as unknown as typeof fetch).deliver(notification, delivery)).rejects.toMatchObject({
      retryable: false,
      message: "HTTP 403: You are not allowed to create a Tweet with duplicate content.",
    });
  });

  it("retries a rate limit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429 }));
    await expect(subscriberWith(fetchMock as unknown as typeof fetch).deliver(notification, delivery)).rejects.toMatchObject({
      retryable: true,
    });
  });

  it("requires all four credentials", () => {
    const result = notificationsConfigSchema.safeParse({ channels: [{ ...entry, accessTokenSecret: undefined }] });
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join("."))).toEqual(["channels.0.accessTokenSecret"]);
  });
});
