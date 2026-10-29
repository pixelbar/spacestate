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

/** Bounds the first-seen set: scanners rotate IPs, and a replica can run for days. */
const MAX_TRACKED_CALLERS = 1000;

/**
 * Records one Sentry metric pair per legacy endpoint hit, whatever the outcome
 * (success, rejected, 5xx), and logs the caller with as much detail as the
 * request exposes: socket + forwarded IPs, user agent, and every header.
 * Credentials (token query param, auth/cookie headers) are redacted.
 *
 * - `legacy.hits` counter and `legacy.response_time` distribution are sliced
 *   only by low-cardinality attributes (route, method, status). They are what
 *   counts the polling.
 * - `legacy.caller` (info) is logged the first time this replica sees a
 *   caller — route, client IP and user agent — so the list of who still needs
 *   migrating stays short enough to read.
 * - `legacy.hit` (debug) is logged for every hit, for `LOG_LEVEL=debug`.
 *
 * Called directly (not via register()) in legacyPlugin before the routes are
 * registered: a hook added in a separate plugin would be encapsulated and
 * never reach the sibling route plugins.
 */
export function addCallerMetrics(fastify: FastifyInstance): void {
  const seenCallers = new Set<string>();

  fastify.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? request.url;
    const caller = callerAttributes(request);
    const status = reply.statusCode;

    // Metric attributes become series dimensions, so only bounded values go
    // here: IP and user agent are client-controlled on these public routes and
    // would create unbounded series. They stay on the log below.
    const dimensions = { route, method: request.method, status };

    Sentry.metrics.count("legacy.hits", 1, { attributes: dimensions });
    Sentry.metrics.distribution("legacy.response_time", reply.elapsedTime, {
      unit: "millisecond",
      attributes: dimensions,
    });
    const attributes = { ...caller, route, method: request.method, status };
    const callerKey = JSON.stringify([route, caller.client_ip, caller.user_agent]);
    if (!seenCallers.has(callerKey)) {
      if (seenCallers.size >= MAX_TRACKED_CALLERS) seenCallers.clear();
      seenCallers.add(callerKey);
      Sentry.logger.info("legacy.caller", attributes);
    }
    Sentry.logger.debug("legacy.hit", attributes);
  });
}
