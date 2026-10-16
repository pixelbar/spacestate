import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/buildTestApp.js";

// Matches config/*.sample.* files's "Pixelbar Rotterdam" legacy device.
const DEVICE_TOKEN = "dev-legacy-token-manual";
const DEVICE_IP = "203.0.113.10";

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await buildTestApp());
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("legacy adapter", () => {
  it("reports the default closed state in the legacy shape", async () => {
    const response = await app.inject({ method: "GET", url: "/spacestate.php" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "closed" });
  });

  it("serves the SpaceAPI document at both legacy paths with matching content", async () => {
    const atRoot = await app.inject({ method: "GET", url: "/" });
    const atIndexPhp = await app.inject({ method: "GET", url: "/index.php" });

    expect(atRoot.statusCode).toBe(200);
    expect(atRoot.json()).toEqual(atIndexPhp.json());
    expect(atRoot.json().api).toBe("0.13");
    expect(atRoot.json().space).toBe("Pixelbar");
  });

  it("redirects to pixelbar.nl on a missing or invalid token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/togglestate.php?token=not-a-real-token&user=x&state=open",
      remoteAddress: DEVICE_IP,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://www.pixelbar.nl/");
  });

  it("redirects when the token is valid but the IP doesn't match the device", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/togglestate.php?token=${DEVICE_TOKEN}&user=x&state=open`,
      remoteAddress: "198.51.100.1",
    });

    expect(response.statusCode).toBe(302);
  });

  it("toggles state with a valid token+IP, then reports the legacy typo on repeat", async () => {
    const query = `token=${DEVICE_TOKEN}&user=Pixelbar&state=open`;

    const first = await app.inject({
      method: "GET",
      url: `/togglestate.php?${query}`,
      remoteAddress: DEVICE_IP,
    });
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe("SUCCESS");

    const second = await app.inject({
      method: "GET",
      url: `/togglestate.php?${query}`,
      remoteAddress: DEVICE_IP,
    });
    expect(second.body).toBe("ALLREADY TOGGLED TO THIS STATE");

    const state = await app.inject({ method: "GET", url: "/spacestate.php" });
    expect(state.json()).toEqual({ state: "open" });
  });

  it("/togglebaker.php is an alias of the same handler", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/togglebaker.php?token=${DEVICE_TOKEN}&user=Pixelbar&state=closed`,
      remoteAddress: DEVICE_IP,
    });

    expect(response.body).toBe("SUCCESS");
  });

  it("accepts POST with params in the query string and ignores the body, like the PHP's $_GET", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/togglestate.php?token=${DEVICE_TOKEN}&user=Pixelbar&state=open`,
      remoteAddress: DEVICE_IP,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "token=ignored&user=ignored&state=closed",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("SUCCESS");
    const state = await app.inject({ method: "GET", url: "/spacestate.php" });
    expect(state.json()).toEqual({ state: "open" });
  });

  it("POST with no query params redirects even if the body carries them", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/togglebaker.php",
      remoteAddress: DEVICE_IP,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://www.pixelbar.nl/");
  });
});
