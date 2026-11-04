import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { RoutineRequestLogController } from "../../src/observability/logController.js";

async function messagesAt(level: string): Promise<string[]> {
  const lines: string[] = [];
  const app = Fastify({
    logger: { level, stream: { write: (line: string) => void lines.push(line) } },
    logController: new RoutineRequestLogController(),
  });
  app.get("/api/v1/state", async () => ({ state: "open" }));
  app.get("/boom", async () => {
    throw new Error("storage exploded");
  });
  await app.inject({ method: "GET", url: "/api/v1/state" });
  await app.inject({ method: "GET", url: "/.env" });
  await app.inject({ method: "GET", url: "/boom" });
  await app.close();
  return lines.map((line) => (JSON.parse(line) as { msg: string }).msg);
}

describe("RoutineRequestLogController", () => {
  it("logs no per-request or 404 lines at info", async () => {
    const messages = await messagesAt("info");
    expect(messages).not.toContain("incoming request");
    expect(messages).not.toContain("request completed");
    expect(messages.some((m) => m.includes("not found"))).toBe(false);
  });

  it("brings them back at debug", async () => {
    const messages = await messagesAt("debug");
    expect(messages).toContain("request completed");
    expect(messages).toContain("Route GET:/.env not found");
    expect(messages).not.toContain("incoming request");
  });

  it("logs incoming requests at trace", async () => {
    expect(await messagesAt("trace")).toContain("incoming request");
  });
});
