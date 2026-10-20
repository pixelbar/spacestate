import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContractApp, type ContractApp } from "../helpers/buildContractApp.js";
import { legacyRecording } from "../helpers/legacyFixtures.js";
import { DEVICE } from "./legacyParity.js";

/**
 * The toggle endpoints are write endpoints on the live host, so nothing here
 * was recorded from it — calling it would change the real space status. The
 * expectations come from SpaceStateScripts/togglestate.php and
 * togglebaker.php instead, and are pinned in
 * test/fixtures/legacy/recording.json under `togglestate.outcomes`.
 */

const { changed, noop, rejected } = legacyRecording.endpoints.togglestate.outcomes!;
const PATHS = ["/togglestate.php", "/togglebaker.php"] as const;
const METHODS = ["GET", "POST"] as const;

let contract: ContractApp;

beforeAll(async () => {
  contract = await buildContractApp();
});

afterAll(async () => {
  await contract.close();
});

function toggle(options: {
  path?: string;
  method?: "GET" | "POST";
  query?: string;
  ip?: string;
  headers?: Record<string, string>;
  payload?: unknown;
}) {
  return contract.app.inject({
    method: options.method ?? "GET",
    url: `${options.path ?? "/togglestate.php"}?${options.query ?? ""}`,
    remoteAddress: options.ip ?? DEVICE.ip,
    headers: options.headers,
    payload: options.payload as never,
  });
}

const validQuery = (state: string) => `token=${DEVICE.token}&user=Pixelbar&state=${state}`;

describe("toggle response bodies and status codes", () => {
  for (const path of PATHS) {
    for (const method of METHODS) {
      it(`answers ${changed.body} on a real change (${method} ${path})`, async () => {
        contract.seedState("closed");
        const response = await toggle({ path, method, query: validQuery("open") });

        expect(response.statusCode).toBe(changed.status);
        expect(response.rawPayload.toString("utf8")).toBe(changed.body);
      });

      it(`answers the legacy typo when already in that state (${method} ${path})`, async () => {
        contract.seedState("open");
        const response = await toggle({ path, method, query: validQuery("open") });

        expect(response.statusCode).toBe(noop.status);
        expect(response.rawPayload.toString("utf8")).toBe(noop.body);
        expect(noop.body).toBe("ALLREADY TOGGLED TO THIS STATE");
      });
    }
  }

  it("closes the space as readily as it opens it", async () => {
    contract.seedState("open");
    const response = await toggle({ query: validQuery("closed") });

    expect(response.statusCode).toBe(changed.status);
    expect(response.rawPayload.toString("utf8")).toBe(changed.body);
    expect((await contract.app.inject({ method: "GET", url: "/spacestate.php" })).json()).toEqual({
      state: "closed",
    });
  });

  it("takes its parameters from the query string, ignoring any body", async () => {
    // The PHP read `$_GET` whatever the method, and never looked at the body.
    contract.seedState("closed");
    const response = await toggle({
      method: "POST",
      query: validQuery("open"),
      headers: { "content-type": "application/json" },
      payload: '{"state":"closed","not":"json at all',
    });

    expect(response.statusCode).toBe(changed.status);
    expect(response.rawPayload.toString("utf8")).toBe(changed.body);
  });

  it("sends the body as text, with no trailing newline", async () => {
    contract.seedState("closed");
    const response = await toggle({ query: validQuery("open") });

    expect(response.headers["content-length"]).toBe(String(changed.body.length));
    // A documented difference: the PHP set no Content-Type, so the string
    // went out as text/html. See test/contract/README.md.
    expect(response.headers["content-type"]).toBe("text/plain");
  });

  it("sets no CORS or caching headers, as the legacy toggle did not", async () => {
    contract.seedState("closed");
    const response = await toggle({ query: validQuery("open") });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBeUndefined();
  });
});

describe("the redirect on invalid input", () => {
  const cases: Array<[string, { query: string; ip?: string }]> = [
    ["an unrecognised state value", { query: validQuery("banana") }],
    ["an empty state value", { query: `token=${DEVICE.token}&user=Pixelbar&state=` }],
    ["no parameters at all", { query: "" }],
    ["a missing token", { query: "user=Pixelbar&state=open" }],
    ["a missing user", { query: `token=${DEVICE.token}&state=open` }],
    ["a missing state", { query: `token=${DEVICE.token}&user=Pixelbar` }],
    ["an unknown token", { query: "token=not-a-real-token&user=Pixelbar&state=open" }],
    ["a known token from the wrong address", { query: validQuery("open"), ip: "198.51.100.1" }],
  ];

  for (const path of PATHS) {
    for (const [description, options] of cases) {
      it(`redirects to pixelbar.nl on ${description} (${path})`, async () => {
        contract.seedState("closed");
        const response = await toggle({ path, ...options });

        // `header('Location: ...')` with no status argument is a 302 in PHP.
        expect(response.statusCode).toBe(rejected.status);
        expect(response.headers.location).toBe(rejected.headers?.location);
        expect(response.rawPayload.toString("utf8")).toBe(rejected.body);
      });
    }
  }

  it("changes nothing when it redirects", async () => {
    contract.seedState("closed");
    await toggle({ query: "token=not-a-real-token&user=Pixelbar&state=open" });

    expect((await contract.app.inject({ method: "GET", url: "/spacestate.php" })).json()).toEqual({
      state: "closed",
    });
  });
});

describe("the legacy X-Forwarded-For quirk", () => {
  it("accepts the device when the forwarded address is the registered one", async () => {
    contract.seedState("closed");
    const response = await toggle({
      query: validQuery("open"),
      ip: "198.51.100.1",
      headers: { "x-forwarded-for": DEVICE.ip },
    });

    expect(response.rawPayload.toString("utf8")).toBe(changed.body);
  });

  it("rejects a forwarded address that is not the registered one", async () => {
    contract.seedState("closed");
    const response = await toggle({
      query: validQuery("open"),
      headers: { "x-forwarded-for": "198.51.100.1" },
    });

    expect(response.statusCode).toBe(rejected.status);
  });
});

describe("deliberate divergences from the legacy toggle", () => {
  it("checks the token before answering ALLREADY TOGGLED TO THIS STATE", async () => {
    // The PHP compared the requested state against the current one *before*
    // looking up the token, so any caller could learn the current state from
    // this endpoint. The rewrite authenticates first; an unknown token gets
    // the redirect even when the state already matches. See
    // test/contract/README.md.
    contract.seedState("open");
    const response = await toggle({ query: "token=not-a-real-token&user=Pixelbar&state=open" });

    expect(response.statusCode).toBe(rejected.status);
    expect(response.rawPayload.toString("utf8")).not.toBe(noop.body);
  });

  it("treats both toggle paths identically", async () => {
    // In the legacy system the two files differed only in a debug flag and
    // in togglebaker.php not honouring X-Forwarded-For. Neither was a
    // behaviour worth preserving per-path.
    contract.seedState("closed");
    const baker = await toggle({
      path: "/togglebaker.php",
      query: validQuery("open"),
      ip: "198.51.100.1",
      headers: { "x-forwarded-for": DEVICE.ip },
    });

    expect(baker.rawPayload.toString("utf8")).toBe(changed.body);
  });
});
