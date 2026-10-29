import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { isLevelEnabled, isNotableRequest, logLevel } from "./policy.js";

/**
 * Must run before anything else is imported (see index.ts) — Sentry's
 * Fastify/Node auto-instrumentation patches modules as they're first
 * loaded, so it has to be initialized first to see them.
 *
 * No-ops cleanly when SENTRY_DSN is unset (local dev, tests, CI) — every
 * Sentry.* call elsewhere in the app is then a safe no-op, no extra guards
 * needed at the call sites.
 *
 * @returns whether Sentry was initialized, i.e. whether a DSN was present.
 * index.ts logs this at startup so a deploy that reports nothing is visible
 * in the logs instead of only in Sentry's absence.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;

  const minLogLevel = logLevel();
  const notableRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1.0);
  const routineRate = Number(process.env.SENTRY_ROUTINE_TRACES_SAMPLE_RATE ?? 0.01);

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    // Every state change and history read is traced; polls, 404s and
    // background work (config reloads) are sampled, which is enough for
    // latency and throughput. A poll's rate is fixed rather than inherited
    // from an incoming trace, so a caller that traces everything can't
    // multiply it back up.
    tracesSampler: ({ attributes, normalizedRequest }) => {
      const path = attributes?.["url.path"];
      const method = attributes?.["http.request.method"] ?? normalizedRequest?.method;
      const notable =
        attributes?.["sentry.op"] === "http.server" &&
        typeof path === "string" &&
        isNotableRequest(typeof method === "string" ? method : undefined, path);
      return notable ? notableRate : routineRate;
    },
    // pino already drops lines below LOG_LEVEL; this applies the same floor
    // to direct Sentry.logger.* calls.
    beforeSendLog: (log) => (isLevelEnabled(log.level, minLogLevel) ? log : null),
    integrations: [
      Sentry.fastifyIntegration(),
      // Forwards Fastify's pino logs (request.log / app.log) to Sentry Logs,
      // while still writing them to stdout.
      Sentry.pinoIntegration(),
      Sentry.nodeRuntimeMetricsIntegration(),
      nodeProfilingIntegration(),
    ],
    // Set sampling rate for profiling - evaluated once per SDK.init call
    profileSessionSampleRate: Number(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE ?? 1.0),
    // Trace lifecycle automatically enables profiling during active traces
    profileLifecycle: "trace",
  });

  return true;
}
