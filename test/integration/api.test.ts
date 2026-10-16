import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/buildTestApp.js";

// Matches config/*.sample.* files.
const READ_KEY = "dev-read-key-0000000000";
const WRITE_KEY = "dev-write-key-0000000000";

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await buildTestApp());
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("new API", () => {
  it("GET /api/v1/state requires no auth and starts closed", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/state" });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("closed");
  });

  it("POST /api/v1/state rejects requests without a write-scoped key", async () => {
    const noAuth = await app.inject({
      method: "POST",
      url: "/api/v1/state",
      payload: { state: "open", user: "alice", method: "api" },
    });
    expect(noAuth.statusCode).toBe(401);

    const readOnly = await app.inject({
      method: "POST",
      url: "/api/v1/state",
      headers: { authorization: `Bearer ${READ_KEY}` },
      payload: { state: "open", user: "alice", method: "api" },
    });
    expect(readOnly.statusCode).toBe(401);
  });

  it("POST /api/v1/state with a write key changes state, and history reflects it", async () => {
    const write = await app.inject({
      method: "POST",
      url: "/api/v1/state",
      headers: { authorization: `Bearer ${WRITE_KEY}` },
      payload: { state: "open", user: "alice", method: "api" },
    });
    expect(write.statusCode).toBe(200);
    expect(write.json().state).toBe("open");

    const state = await app.inject({ method: "GET", url: "/api/v1/state" });
    expect(state.json().state).toBe("open");

    const history = await app.inject({
      method: "GET",
      url: "/api/v1/history",
      headers: { authorization: `Bearer ${READ_KEY}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items[0]).toMatchObject({ state: "open", user: "alice", source: "api" });
  });

  it("GET /api/v1/spaceapi returns a SpaceAPI document", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/spaceapi" });
    expect(response.statusCode).toBe(200);
    expect(response.json().api).toBe("0.13");
  });
});
