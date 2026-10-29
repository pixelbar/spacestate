import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", () => ({
  init,
  fastifyIntegration: () => ({ name: "fastify" }),
  pinoIntegration: () => ({ name: "pino" }),
  nodeRuntimeMetricsIntegration: () => ({ name: "runtime-metrics" }),
}));
vi.mock("@sentry/profiling-node", () => ({ nodeProfilingIntegration: () => ({ name: "profiling" }) }));

import { initSentry } from "../../src/observability/sentry.js";

describe("initSentry", () => {
  const saved = { SENTRY_DSN: process.env.SENTRY_DSN, LOG_LEVEL: process.env.LOG_LEVEL };

  beforeEach(() => init.mockClear());
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function initOptions() {
    process.env.SENTRY_DSN = "https://key@o0.ingest.de.sentry.io/1";
    initSentry();
    return init.mock.calls[0]?.[0];
  }

  it("reports disabled and does not initialize without a DSN", () => {
    delete process.env.SENTRY_DSN;
    expect(initSentry()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("treats a blank DSN as disabled, so a half-set variable can't look enabled", () => {
    process.env.SENTRY_DSN = "   ";
    expect(initSentry()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("reports enabled and initializes with a DSN", () => {
    process.env.SENTRY_DSN = "https://key@o0.ingest.de.sentry.io/1";
    expect(initSentry()).toBe(true);
    expect(init).toHaveBeenCalledOnce();
    expect(init.mock.calls[0]?.[0]).toMatchObject({ dsn: "https://key@o0.ingest.de.sentry.io/1" });
  });

  it("traces state changes in full and samples routine requests", () => {
    const { tracesSampler } = initOptions();
    const server = (method: string, path: string) =>
      tracesSampler({
        name: `${method} ${path}`,
        attributes: { "sentry.op": "http.server", "url.path": path, "http.request.method": method },
        inheritOrSampleWith: () => 1,
      });

    expect(server("GET", "/togglestate.php")).toBe(1);
    expect(server("POST", "/api/v1/state")).toBe(1);
    expect(server("GET", "/api/v1/state")).toBe(0.01);
    expect(server("GET", "/")).toBe(0.01);
    expect(server("GET", "/.env")).toBe(0.01);
    // Background work outside a request (config reloads) is routine too.
    expect(tracesSampler({ name: "GET", attributes: { "sentry.op": "http.client" } })).toBe(0.01);
  });

  it("drops Sentry logs below LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "info";
    const { beforeSendLog } = initOptions();
    expect(beforeSendLog({ level: "debug", message: "served from pointer" })).toBeNull();
    expect(beforeSendLog({ level: "warn", message: "rejected" })).not.toBeNull();
  });

  it("forwards debug logs with LOG_LEVEL=debug", () => {
    process.env.LOG_LEVEL = "debug";
    const { beforeSendLog } = initOptions();
    expect(beforeSendLog({ level: "debug", message: "served from pointer" })).not.toBeNull();
  });
});
