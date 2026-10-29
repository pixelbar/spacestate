import * as Sentry from "@sentry/node";
import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Shapes the client-facing response and reports server errors (5xx) to
 * Sentry explicitly. We don't rely on fastifyIntegration alone: it only
 * traces, and a custom error handler swallows the error before Sentry sees
 * it. 4xx errors are client mistakes: they stay out of Sentry Issues and are
 * logged at info, not error, so they don't read as failures in Sentry Logs.
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const route = request.routeOptions?.url ?? request.url;
    if (statusCode < 500) {
      request.log.info({ err: error, route, method: request.method, statusCode }, "request rejected");
    } else {
      request.log.error({ err: error, route, method: request.method, statusCode }, "request failed");
      Sentry.captureException(error, {
        tags: { route },
        extra: { method: request.method, url: request.url },
      });
    }
    reply.code(statusCode).send({ error: statusCode === 500 ? "internal_error" : error.message });
  });
}
