import * as Sentry from "@sentry/node";
import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Shapes the client-facing response and reports server errors (5xx) to
 * Sentry explicitly. We don't rely on fastifyIntegration alone: it only
 * traces, and a custom error handler swallows the error before Sentry sees
 * it. 4xx errors are client mistakes and stay out of Sentry (they are still
 * logged).
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      Sentry.captureException(error, {
        tags: { route: request.routeOptions?.url ?? request.url },
        extra: { method: request.method, url: request.url },
      });
    }
    reply.code(statusCode).send({ error: statusCode === 500 ? "internal_error" : error.message });
  });
}
