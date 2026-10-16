import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", () => ({ captureException }));

import { registerErrorHandler } from "../../src/plugins/errorHandler.js";

function buildApp() {
  const app = Fastify();
  registerErrorHandler(app);
  app.get("/boom", async () => {
    throw new Error("storage exploded");
  });
  app.get("/bad", async () => {
    throw Object.assign(new Error("nope"), { statusCode: 400 });
  });
  return app;
}

describe("error handler", () => {
  beforeEach(() => captureException.mockClear());

  it("reports 5xx errors to Sentry and hides the message from clients", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error" });
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({ tags: { route: "/boom" } });
  });

  it("does not report 4xx errors", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/bad" });
    expect(res.statusCode).toBe(400);
    expect(captureException).not.toHaveBeenCalled();
  });
});
