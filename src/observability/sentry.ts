import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

/**
 * Must run before anything else is imported (see index.ts) — Sentry's
 * Fastify/Node auto-instrumentation patches modules as they're first
 * loaded, so it has to be initialized first to see them.
 *
 * No-ops cleanly when SENTRY_DSN is unset (local dev, tests, CI) — every
 * Sentry.* call elsewhere in the app is then a safe no-op, no extra guards
 * needed at the call sites.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
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
}
