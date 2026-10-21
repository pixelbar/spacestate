import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  fastifyIntegration: vi.fn(() => ({ name: "Fastify" })),
  pinoIntegration: vi.fn(() => ({ name: "Pino" })),
  nodeRuntimeMetricsIntegration: vi.fn(() => ({ name: "NodeRuntimeMetrics" })),
}));
vi.mock("@sentry/node", () => sentry);
vi.mock("@sentry/profiling-node", () => ({
  nodeProfilingIntegration: vi.fn(() => ({ name: "ProfilingNode" })),
}));

import { initSentry } from "../../src/observability/sentry.js";

/** Never use a real credential here — this is a made-up value. */
const TOKEN = "s3cr3t-test-token";

function initOptions() {
  initSentry();
  expect(sentry.init).toHaveBeenCalledOnce();
  return sentry.init.mock.calls[0]?.[0] as Record<string, (...args: unknown[]) => unknown>;
}

function noToken(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(TOKEN);
}

describe("initSentry", () => {
  const previousDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";
  });

  afterEach(() => {
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  });

  it("does nothing without a DSN", () => {
    delete process.env.SENTRY_DSN;
    expect(initSentry()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("preserves the startup enabled flag and ignores blank DSNs", () => {
    expect(initSentry()).toBe(true);
    sentry.init.mockClear();
    process.env.SENTRY_DSN = "  ";
    expect(initSentry()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("scrubs tokens out of every payload kind before it is sent", () => {
    const options = initOptions();
    const url = `http://localhost/togglestate.php?user=Pixelbar&token=${TOKEN}`;

    const event = options.beforeSend?.(
      {
        request: { url, query_string: `user=Pixelbar&token=${TOKEN}` },
        extra: { url },
        tags: { route: `/togglestate.php?token=${TOKEN}` },
        exception: { values: [{ value: `Route POST:${url} not found` }] },
      },
      {},
    );
    noToken(event);

    noToken(options.beforeSendTransaction?.({ transaction: `POST ${url}`, request: { url } }, {}));
    noToken(
      options.beforeSendSpan?.({
        name: `POST ${url}`,
        span_id: "a",
        trace_id: "b",
        start_timestamp: 0,
        status: "ok",
        is_segment: true,
        attributes: { "url.full": url, "url.query": `token=${TOKEN}` },
      }),
    );
    noToken(options.beforeBreadcrumb?.({ message: `GET ${url}`, data: { url } }));
    noToken(
      options.beforeSendLog?.({
        level: "info",
        message: `legacy.hit ${url}`,
        attributes: { url, token: TOKEN },
      }),
    );
  });

  it("keeps the fields that are not credentials", () => {
    const options = initOptions();
    const span = options.beforeSendSpan?.({
      name: "GET /api/v1/state",
      span_id: "a",
      trace_id: "b",
      start_timestamp: 0,
      status: "ok",
      is_segment: true,
      attributes: { "http.request.method": "GET", "http.response.status_code": 200 },
    }) as { name: string; attributes: Record<string, unknown> };

    expect(span.name).toBe("GET /api/v1/state");
    expect(span.attributes).toMatchObject({ "http.request.method": "GET", "http.response.status_code": 200 });
  });
});
