import * as Sentry from "@sentry/node";
import type { FastifyError, FastifyInstance } from "fastify";
import { redactSecrets, redactUrl } from "../observability/redact.js";

/**
 * Shapes the client-facing response and reports server errors (5xx) to
 * Sentry explicitly. We don't rely on fastifyIntegration alone: it only
 * traces, and a custom error handler swallows the error before Sentry sees
 * it. 4xx errors are client mistakes and stay out of Sentry (they are still
 * logged).
 *
 * URLs are redacted on the way out (issue #14): on the legacy routes the
 * query string carries the device token, and both the log line and the Sentry
 * event would otherwise carry it.
 */
export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) {
      Sentry.captureException(error, {
        tags: { route: redactUrl(request.routeOptions?.url ?? request.url) },
        extra: { method: request.method, url: redactUrl(request.url) },
      });
    }
    reply
      .code(statusCode)
      .send({ error: statusCode === 500 ? "internal_error" : redactSecrets(error.message) });
  });
}

/**
 * Replaces Fastify's default 404, which echoed the full request URL in both
 * the response body and a log line ("Route POST:/togglestate.php?…&token=…
 * not found") — that is how a legacy token reached Sentry Logs (issue #14).
 * The generic body says nothing about the request; the warning logs the
 * method and the redacted URL.
 */
export function registerNotFoundHandler(fastify: FastifyInstance): void {
  fastify.setNotFoundHandler((request, reply) => {
    request.log.warn({ method: request.method, url: redactUrl(request.url) }, "route not found");
    reply.code(404).send({ error: "not_found" });
  });
}
