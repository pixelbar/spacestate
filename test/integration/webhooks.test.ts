import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sign } from "../../src/notifications/webhooks/subscribers.js";
import { buildTestApp } from "../helpers/buildTestApp.js";

// The receiver below is plain http on loopback, which production policy forbids.
process.env.WEBHOOK_ALLOW_INSECURE = "true";
process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = "true";

const READ_KEY = "dev-read-key-0000000000";
const WRITE_KEY = "dev-write-key-0000000000";
const auth = (key: string) => ({ authorization: `Bearer ${key}` });

interface Received {
  headers: IncomingMessage["headers"];
  body: string;
}

let app: FastifyInstance;
let receiver: Server;
let receiverUrl: string;
const received: Received[] = [];

beforeAll(async () => {
  receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  ({ app } = await buildTestApp());
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => receiver.close(resolve));
});

describe("webhook registration", () => {
  it("requires a write key for every operation", async () => {
    for (const [method, url] of [
      ["GET", "/api/v1/webhooks"],
      ["POST", "/api/v1/webhooks"],
      ["DELETE", "/api/v1/webhooks/wh_x"],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect((await app.inject({ method, url, headers: auth(READ_KEY) })).statusCode).toBe(401);
    }
  });

  it("rejects a malformed body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers: auth(WRITE_KEY),
      payload: { nope: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it("registers, lists without the secret, rejects duplicates, and deletes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers: auth(WRITE_KEY),
      payload: { url: receiverUrl, description: "test receiver" },
    });
    expect(created.statusCode).toBe(201);
    const { id, secret } = created.json();
    expect(id).toMatch(/^wh_/);
    expect(secret.length).toBeGreaterThanOrEqual(16);

    const list = await app.inject({ method: "GET", url: "/api/v1/webhooks", headers: auth(WRITE_KEY) });
    expect(list.json().webhooks).toEqual([
      expect.objectContaining({ id, url: receiverUrl, description: "test receiver", createdBy: "dev-writer" }),
    ]);
    expect(list.body).not.toContain(secret);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers: auth(WRITE_KEY),
      payload: { url: receiverUrl },
    });
    expect(duplicate.statusCode).toBe(409);

    expect((await app.inject({ method: "DELETE", url: `/api/v1/webhooks/${id}`, headers: auth(WRITE_KEY) })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/webhooks/${id}`, headers: auth(WRITE_KEY) })).statusCode).toBe(404);
  });
});

describe("webhook ownership", () => {
  const OTHER_KEY = "dev-other-write-key-000000";

  it("hides one key's webhooks from another and refuses to delete them", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers: auth(WRITE_KEY),
      payload: { url: "https://mine.example.org/hook" },
    });
    const { id } = created.json();

    const list = await app.inject({ method: "GET", url: "/api/v1/webhooks", headers: auth(OTHER_KEY) });
    expect(list.json().webhooks).toEqual([]);
    expect(list.body).not.toContain("mine.example.org");

    const del = await app.inject({ method: "DELETE", url: `/api/v1/webhooks/${id}`, headers: auth(OTHER_KEY) });
    expect(del.statusCode).toBe(404);

    // Registering the same URL as someone else neither fails nor reveals theirs.
    const same = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers: auth(OTHER_KEY),
      payload: { url: "https://mine.example.org/hook" },
    });
    expect(same.statusCode).toBe(201);
    expect(same.json().id).not.toBe(id);

    expect((await app.inject({ method: "DELETE", url: `/api/v1/webhooks/${id}`, headers: auth(WRITE_KEY) })).statusCode).toBe(204);
  });
});

describe("webhook delivery", () => {
  it("notifies a registered receiver when the state changes, and not on a no-op", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks",
      headers: auth(WRITE_KEY),
      payload: { url: receiverUrl },
    });
    const { secret } = created.json();

    const change = (state: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/state",
        headers: auth(WRITE_KEY),
        payload: { state, user: "alice", method: "web" },
      });

    expect((await change("open")).statusCode).toBe(200);
    await expect.poll(() => received.length).toBe(1);

    const [delivery] = received;
    expect(JSON.parse(delivery!.body)).toMatchObject({
      event: "state.changed",
      state: "open",
      previousState: "closed",
      changedBy: "alice",
      source: "api",
    });
    const timestamp = delivery!.headers["x-spacestate-timestamp"] as string;
    expect(delivery!.headers["x-spacestate-signature"]).toBe(sign(secret, timestamp, delivery!.body));

    // Already open: 409, nothing recorded, nothing sent.
    expect((await change("open")).statusCode).toBe(409);
    expect((await change("closed")).statusCode).toBe(200);
    await expect.poll(() => received.length).toBe(2);
    expect(JSON.parse(received[1]!.body).state).toBe("closed");
  });

  it("also fires for changes made through the legacy endpoint", async () => {
    const before = received.length;
    const response = await app.inject({
      method: "GET",
      url: "/togglestate.php?token=dev-legacy-token-manual&user=bob&state=open",
      remoteAddress: "203.0.113.10",
    });
    expect(response.statusCode).toBe(200);
    await expect.poll(() => received.length).toBe(before + 1);
    expect(JSON.parse(received[before]!.body)).toMatchObject({ state: "open", source: "legacy", changedBy: "bob" });
  });
});
