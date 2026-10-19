import * as Sentry from "@sentry/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { resolveClientIp } from "../auth/legacyToken.js";

/** Headers whose values are credentials — recorded as present, never with their value. */
const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);
/** Query params that carry credentials (the legacy device token). */
const SECRET_QUERY_PARAMS = new Set(["token"]);
const MAX_VALUE_LENGTH = 512;

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return truncate(Array.isArray(value) ? value.join(", ") : value);
}

function redactedHeaders(request: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    out[name] = SECRET_HEADERS.has(name) ? "[redacted]" : (headerValue(value) ?? "");
  }
  return out;
}

function redactedQuery(request: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const query = (request.query ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(query)) {
    out[name] = SECRET_QUERY_PARAMS.has(name) ? "[redacted]" : truncate(String(value));
  }
  return out;
}

/** Everything we can learn about the caller from the request alone. */
function callerAttributes(request: FastifyRequest): Record<string, string | number | boolean> {
  const h = request.headers;
  const attrs: Record<string, string | number | boolean | undefined> = {
    ip: request.ip,
    client_ip: resolveClientIp(request),
    remote_port: request.socket.remotePort,
    x_forwarded_for: headerValue(h["x-forwarded-for"]),
    x_real_ip: headerValue(h["x-real-ip"]),
    forwarded: headerValue(h.forwarded),
    via: headerValue(h.via),
    user_agent: headerValue(h["user-agent"]),
    referer: headerValue(h.referer),
    origin: headerValue(h.origin),
    host: headerValue(h.host),
    accept: headerValue(h.accept),
    accept_language: headerValue(h["accept-language"]),
    accept_encoding: headerValue(h["accept-encoding"]),
    content_type: headerValue(h["content-type"]),
    content_length: headerValue(h["content-length"]),
    http_version: request.raw.httpVersion,
    protocol: request.protocol,
    url: truncate(request.url.replace(/([?&]token=)[^&]*/g, "$1[redacted]")),
    header_names: Object.keys(h).join(","),
    headers: JSON.stringify(redactedHeaders(request)),
    query: JSON.stringify(redactedQuery(request)),
  };
  return Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined)) as Record<
    string,
    string | number | boolean
  >;
}

/**
 * Records one Sentry metric pair plus one structured log per legacy endpoint
 * hit, whatever the outcome (success, rejected, 5xx), with as much caller
 * detail as the request exposes: socket + forwarded IPs, user agent, and every
 * header. Credentials (token query param, auth/cookie headers) are redacted.
 *
 * - `legacy.hits` counter and `legacy.response_time` distribution carry the
 *   attributes needed to slice by endpoint/caller (route, method, status, IPs,
 *   user agent).
 * - The `legacy.hit` log carries the full detail (all headers, query).
 *
 * Called directly (not via register()) in legacyPlugin before the routes are
 * registered: a hook added in a separate plugin would be encapsulated and
 * never reach the sibling route plugins.
 */
export function addCallerMetrics(fastify: FastifyInstance): void {
  fastify.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    const caller = callerAttributes(request);
    const status = reply.statusCode;

    const dimensions = {
      route,
      method: request.method,
      status,
      ip: caller.ip,
      client_ip: caller.client_ip,
      ...(caller.user_agent !== undefined && { user_agent: caller.user_agent }),
    };

    Sentry.metrics.count("legacy.hits", 1, { attributes: dimensions });
    Sentry.metrics.distribution("legacy.response_time", reply.elapsedTime, {
      unit: "millisecond",
      attributes: dimensions,
    });
    Sentry.logger.info("legacy.hit", { ...caller, route, method: request.method, status });
  });
}
