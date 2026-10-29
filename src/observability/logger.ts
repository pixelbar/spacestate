import type { FastifyRequest } from "fastify";
import { redactUrl, scrubAttributes } from "./redact.js";

/**
 * Redact request URLs and error fields before they reach stdout or Sentry's
 * pino integration. The request fields match Fastify's default serializer.
 */
export const loggerOptions = {
  serializers: {
    err: (error: Error) => scrubAttributes({
      ...error,
      type: error.name,
      message: error.message,
      stack: error.stack ?? "",
      cause: error.cause,
    }),
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: redactUrl(request.url),
      host: request.host,
      remoteAddress: request.ip,
      remotePort: request.socket?.remotePort,
    }),
  },
};
