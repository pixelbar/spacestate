import * as Sentry from "@sentry/node";
import { initSentry } from "./observability/sentry.js";

// Must happen before app.ts (and its transitive imports: fastify, the Azure
// SDKs, etc.) are evaluated, so Sentry's auto-instrumentation can patch them
// on first load. A static top-level import of app.ts would be hoisted ahead
// of this call by the ESM loader — the dynamic import below is what keeps
// the ordering correct.
//
// The return value is logged below: without it, a deploy whose SENTRY_DSN went
// missing looks exactly like a healthy one until someone notices Sentry has
// gone quiet.
const sentryEnabled = initSentry();

const { buildApp } = await import("./app.js");

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

// Startup failures (bad config, unreachable storage, port in use) would
// otherwise crash the process before anything reaches Sentry.
let app: Awaited<ReturnType<typeof buildApp>>["app"];
try {
  ({ app } = await buildApp());
  await app.listen({ port, host });
} catch (err) {
  console.error("Failed to start spacestate", err);
  Sentry.captureException(err);
  await Sentry.close(2000);
  process.exit(1);
}
app.log.info({ port, host, environment: process.env.SENTRY_ENVIRONMENT, sentryEnabled }, "spacestate started");
if (!sentryEnabled) {
  // Only reaches stdout (Log Analytics) — by definition it can't reach Sentry.
  app.log.warn("Sentry is disabled: SENTRY_DSN is unset, so no errors, traces or logs are reported");
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  // Flush buffered logs/events to Sentry before the process exits.
  await Sentry.close(2000);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
