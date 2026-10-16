import { initSentry } from "./observability/sentry.js";

// Must happen before app.ts (and its transitive imports: fastify, the Azure
// SDKs, etc.) are evaluated, so Sentry's auto-instrumentation can patch them
// on first load. A static top-level import of app.ts would be hoisted ahead
// of this call by the ESM loader — the dynamic import below is what keeps
// the ordering correct.
initSentry();

const { buildApp } = await import("./app.js");
const { app } = await buildApp();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
