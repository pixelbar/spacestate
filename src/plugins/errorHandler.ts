import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Sentry's fastifyIntegration (see observability/sentry.ts) already captures
 * unhandled errors automatically via Fastify's error diagnostics channel, so
 * this handler is purely about shaping a consistent client-facing response
 * — it does not also call Sentry.captureException, to avoid double-reporting.
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(statusCode).send({ error: statusCode === 500 ? "internal_error" : error.message });
  });
}
