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
  const dsn = process.env.SENTRY_DSN;

  beforeEach(() => init.mockClear());
  afterEach(() => {
    if (dsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = dsn;
  });

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
});
