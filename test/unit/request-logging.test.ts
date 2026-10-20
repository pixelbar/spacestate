import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "../../src/observability/logger.js";
import { registerErrorHandler, registerNotFoundHandler } from "../../src/plugins/errorHandler.js";

/** Never use a real credential here — this is a made-up value. */
const TOKEN = "s3cr3t-test-token";

async function buildApp() {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      ...loggerOptions,
      level: "trace",
      stream: {
        write(line: string) {
          lines.push(line.trim());
        },
      },
    },
  });
  registerErrorHandler(app);
  registerNotFoundHandler(app);
  app.get("/togglestate.php", async () => "ok");
  app.get("/api/v1/history", async () => ({ items: [] }));
  app.get("/boom", async () => {
    throw new Error("storage exploded");
  });
  await app.ready();
  return { app, lines };
}

describe("request logging", () => {
  it("never writes the legacy token to a log line, on any outcome", async () => {
    const { app, lines } = await buildApp();
    const query = `?user=Pixelbar&token=${TOKEN}&state=open`;

    // A hit, a 404 (the shape that leaked in issue #14: POST is not routed),
    // and a 5xx that goes through the error handler.
    await app.inject({ method: "GET", url: `/togglestate.php${query}` });
    await app.inject({ method: "POST", url: `/togglestate.php${query}` });
    await app.inject({ method: "GET", url: `/nope.php${query}` });
    await app.inject({ method: "GET", url: `/api/v1/history?limit=5&token=${TOKEN}` });
    await app.inject({ method: "GET", url: `/boom${query}` });
    await app.close();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("token=s3cr3t");
    }
    // The path still is logged — redaction must not blind the logs.
    expect(lines.some((line) => line.includes("/togglestate.php?[redacted]"))).toBe(true);
    expect(lines.some((line) => line.includes("/api/v1/history?limit=5&token=[redacted]"))).toBe(true);
  });

  it("answers an unknown route with a generic 404 that does not echo the URL", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "POST", url: `/togglestate.php?user=Pixelbar&token=${TOKEN}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
    expect(res.body).not.toContain(TOKEN);
    expect(res.body).not.toContain("togglestate");
    await app.close();
  });
});
