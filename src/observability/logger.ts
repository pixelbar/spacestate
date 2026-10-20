import type { FastifyRequest } from "fastify";
import { redactUrl } from "./redact.js";

/**
 * Fastify's pino options. The only change from the defaults is the `req`
 * serializer: the default one logs `request.url` verbatim, query string and
 * all, which put a legacy device token in stdout and — via
 * `Sentry.pinoIntegration()` — in Sentry Logs (issue #14). Every other field
 * matches Fastify's default serializer, so log shape is unchanged.
 */
export const loggerOptions = {
  serializers: {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: redactUrl(request.url),
      host: request.host,
      remoteAddress: request.ip,
      remotePort: request.socket?.remotePort,
    }),
  },
};
