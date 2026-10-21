import { describe, expect, it } from "vitest";
import {
  REDACTED,
  redactSecrets,
  redactUrl,
  scrubAttributes,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubSentryLog,
  scrubSpanFields,
} from "../../src/observability/redact.js";

/** Never use a real credential here — this is a made-up value. */
const TOKEN = "s3cr3t-test-token";

function noToken(value: unknown): void {
  const serialized = JSON.stringify(value) ?? String(value);
  expect(serialized).not.toContain(TOKEN);
  expect(serialized).not.toContain("token=s3cr3t");
}

describe("redactSecrets", () => {
  it.each(["<", ">", "'", '"', "#", "?", ";", "="])("does not expose a value suffix after %s", (separator) => {
    expect(redactSecrets(`token=prefix${separator}secret-tail`)).toBe(`token=${REDACTED}`);
  });
  it.each([
    `url=/x?token=${TOKEN}`,
    `a=1;token=${TOKEN}`,
    `outer=inner=token=${TOKEN}`,
    `url=/x?%74oken=${TOKEN}`,
  ])("finds credentials inside non-secret values: %s", (input) => {
    const output = redactSecrets(input);
    noToken(output);
    expect(output).toBe(input.replace(TOKEN, REDACTED));
  });
  it("redacts percent-encoded credential names without redacting paging cursors", () => {
    expect(redactSecrets(`?%74oken=${TOKEN}&access%5Ftoken=${TOKEN}&continuationToken=cursor`)).toBe(
      `?%74oken=${REDACTED}&access%5Ftoken=${REDACTED}&continuationToken=cursor`,
    );
  });
  it("redacts token values wherever they appear in a string", () => {
    const message = `Route POST:/togglestate.php?user=Pixelbar&token=${TOKEN} not found`;
    const redacted = redactSecrets(message);
    expect(redacted).toBe(`Route POST:/togglestate.php?user=Pixelbar&token=${REDACTED} not found`);
    noToken(redacted);
  });

  it("redacts the other credential-carrying parameter names", () => {
    expect(redactSecrets(`a?access_token=${TOKEN}&api_key=${TOKEN}&password=${TOKEN}`)).toBe(
      `a?access_token=${REDACTED}&api_key=${REDACTED}&password=${REDACTED}`,
    );
  });

  it("leaves non-credential parameters alone, including continuation tokens", () => {
    const query = "limit=5&continuationToken=1!52!RGF0ZQ--&not_token=safe&token.foo=safe";
    expect(redactSecrets(query)).toBe(query);
  });

  it("handles long name runs without repeatedly scanning their suffixes", () => {
    const name = "a".repeat(200_000);
    expect(redactSecrets(name)).toBe(name);
    expect(redactSecrets(`${name}=/x?token=${TOKEN}`)).toBe(`${name}=/x?token=${REDACTED}`);
  });

  it("handles empty values, adjacent secrets and assignments inside secret values", () => {
    expect(redactSecrets(`token=&password=${TOKEN}&limit=5`)).toBe(
      `token=${REDACTED}&password=${REDACTED}&limit=5`,
    );
    expect(redactSecrets(`token=prefix;password=${TOKEN}`)).toBe(`token=${REDACTED}`);
  });
});

describe("redactUrl", () => {
  it.each(["https://example.invalid/", "GET /", "POST:https://example.invalid/", "/togglestate.%70hp"])(
    "drops the legacy query for %s", (path) => {
      expect(redactUrl(`${path}?unexpected=${TOKEN}`)).toBe(`${path}?${REDACTED}`);
    },
  );
  it("drops the whole query string on the legacy routes", () => {
    expect(redactUrl(`/togglestate.php?user=Pixelbar&token=${TOKEN}&state=open`)).toBe(
      `/togglestate.php?${REDACTED}`,
    );
    expect(redactUrl(`/togglebaker.php?token=${TOKEN}`)).toBe(`/togglebaker.php?${REDACTED}`);
    expect(redactUrl(`https://spacestate.pixelbar.nl/spacestate.php?token=${TOKEN}`)).toBe(
      `https://spacestate.pixelbar.nl/spacestate.php?${REDACTED}`,
    );
  });

  it("keeps the path and redacts only credentials elsewhere", () => {
    expect(redactUrl(`/api/v1/history?limit=5&token=${TOKEN}`)).toBe(
      `/api/v1/history?limit=5&token=${REDACTED}`,
    );
    expect(redactUrl("/api/v1/state")).toBe("/api/v1/state");
    expect(redactUrl("/togglestate.php")).toBe("/togglestate.php");
  });
});

describe("scrubAttributes", () => {
  it("redacts secret-named keys, URL keys and query keys at any depth", () => {
    const scrubbed = scrubAttributes({
      token: TOKEN,
      authorization: `Bearer ${TOKEN}`,
      "http.url": `http://localhost/togglestate.php?user=Pixelbar&token=${TOKEN}`,
      "url.query": `user=Pixelbar&token=${TOKEN}`,
      nested: { deep: [{ "url.full": `/api/v1/history?token=${TOKEN}` }] },
      note: `called with token=${TOKEN}`,
      user: "Pixelbar",
      status: 200,
    });

    expect(scrubbed.token).toBe(REDACTED);
    expect(scrubbed.authorization).toBe(REDACTED);
    expect(scrubbed["http.url"]).toBe(`http://localhost/togglestate.php?${REDACTED}`);
    expect(scrubbed["url.query"]).toBe(`user=Pixelbar&token=${REDACTED}`);
    expect(scrubbed.user).toBe("Pixelbar");
    expect(scrubbed.status).toBe(200);
    noToken(scrubbed);
  });
});

describe("Sentry payload scrubbing", () => {
  it("scrubs encoded and tuple query strings", () => {
    const event = scrubSentryEvent({
      request: {
        url: `https://example.invalid/?%74oken=${TOKEN}`,
        query_string: [["%74oken", TOKEN], ["limit", "5"]],
      },
    });
    noToken(event);
    expect(event.request?.query_string).toEqual([["%74oken", REDACTED], ["limit", "5"]]);
    noToken(scrubSentryEvent({ request: { query_string: `%74oken=${TOKEN}` } }));
  });

  it("does not return unsanitized objects at the recursion limit", () => {
    let nested: object = { token: TOKEN };
    for (let i = 0; i < 12; i += 1) nested = { nested };
    noToken(scrubAttributes(nested));
  });
  it("scrubs events: request, tags, extra, breadcrumbs, exceptions and spans", () => {
    const event = scrubSentryEvent({
      message: `failed for token=${TOKEN}`,
      transaction: `POST /togglestate.php?token=${TOKEN}`,
      request: {
        url: `http://localhost/togglestate.php?user=Pixelbar&token=${TOKEN}`,
        query_string: `user=Pixelbar&token=${TOKEN}`,
        headers: { authorization: `Bearer ${TOKEN}`, "user-agent": "ESP8266HTTPClient" },
      },
      tags: { route: `/togglestate.php?token=${TOKEN}` },
      extra: { url: `/togglestate.php?token=${TOKEN}`, method: "POST" },
      breadcrumbs: [{ message: `GET /togglestate.php?token=${TOKEN}`, data: { token: TOKEN } }],
      exception: { values: [{ value: `boom while handling token=${TOKEN}` }] },
      spans: [
        {
          span_id: "a",
          trace_id: "b",
          start_timestamp: 0,
          op: "http.server",
          description: `POST /togglestate.php?token=${TOKEN}`,
          data: { "http.url": `http://localhost/togglestate.php?token=${TOKEN}` },
        },
      ],
    });

    noToken(event);
    expect(event.request?.url).toBe(`http://localhost/togglestate.php?${REDACTED}`);
    expect(event.request?.headers?.["user-agent"]).toBe("ESP8266HTTPClient");
    expect(event.extra?.method).toBe("POST");
  });

  it("scrubs logs, breadcrumbs and spans", () => {
    const log = scrubSentryLog({
      level: "info",
      message: `legacy.hit token=${TOKEN}`,
      attributes: { url: `/togglestate.php?token=${TOKEN}`, route: "/togglestate.php" },
    });
    noToken(log);
    expect(log.attributes?.route).toBe("/togglestate.php");

    noToken(scrubSentryBreadcrumb({ message: `?token=${TOKEN}`, data: { url: `/x?token=${TOKEN}` } }));

    const span = scrubSpanFields({
      name: `POST /togglestate.php?token=${TOKEN}`,
      attributes: { "url.full": `http://localhost/togglestate.php?token=${TOKEN}`, "http.method": "POST" },
    });
    noToken(span);
    expect(span.attributes["http.method"]).toBe("POST");
  });
});
