import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  metrics: { count: vi.fn(), distribution: vi.fn() },
  logger: { info: vi.fn() },
}));
vi.mock("@sentry/node", () => sentry);

import { addCallerMetrics } from "../../src/legacy/callerMetrics.js";

async function buildApp() {
  const app = Fastify();
  addCallerMetrics(app);
  app.get("/togglestate.php", async () => "ok");
  await app.ready();
  return app;
}

describe("legacy caller metrics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a hit with caller detail and redacts credentials", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/togglestate.php?token=s3cret&user=bob&state=open",
      headers: {
        "user-agent": "ESP8266HTTPClient",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1",
        authorization: "Bearer hunter2",
        cookie: "a=b",
      },
      remoteAddress: "203.0.113.10",
    });

    expect(sentry.metrics.count).toHaveBeenCalledWith("legacy.hits", 1, {
      attributes: expect.objectContaining({
        route: "/togglestate.php",
        method: "GET",
        status: 200,
        ip: "203.0.113.10",
        client_ip: "198.51.100.7",
        user_agent: "ESP8266HTTPClient",
      }),
    });
    expect(sentry.metrics.distribution).toHaveBeenCalledOnce();

    const [message, attrs] = sentry.logger.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe("legacy.hit");
    expect(attrs.x_forwarded_for).toBe("198.51.100.7, 10.0.0.1");
    const serialized = JSON.stringify(attrs);
    expect(serialized).not.toContain("s3cret");
    expect(serialized).not.toContain("hunter2");
    expect(JSON.parse(attrs.headers as string).authorization).toBe("[redacted]");
    expect(JSON.parse(attrs.query as string)).toMatchObject({ token: "[redacted]", user: "bob" });
    await app.close();
  });
});
