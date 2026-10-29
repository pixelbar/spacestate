import type { Breadcrumb, Event, Log } from "@sentry/node";

/**
 * The one place that knows how to strip credentials out of text we are about
 * to log or send to Sentry. Everything that writes a URL, a query string or a
 * bag of attributes somewhere goes through here — the pino request
 * serializer, the error handler, `legacy/callerMetrics.ts`, and Sentry's
 * `beforeSend*` hooks in `observability/sentry.ts`.
 *
 * The legacy endpoints take their device token as a `token` query parameter
 * (see issue #14: one leaked into Sentry Logs via Fastify's default request
 * log and its default "Route … not found" message), so a credential can show
 * up in any string that happens to carry a URL.
 */

export const REDACTED = "[redacted]";

/** Query parameters and attribute keys whose values are credentials. */
const SECRET_NAMES = [
  "token",
  "access_token",
  "api_key",
  "api-key",
  "apikey",
  "x-api-key",
  "secret",
  "password",
  "authorization",
  "cookie",
] as const;

const SECRET_NAME_SET: ReadonlySet<string> = new Set(SECRET_NAMES);

function isSecretName(name: string): boolean {
  try {
    name = decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    // Malformed escapes cannot decode to an accepted credential name.
  }
  return SECRET_NAME_SET.has(name.toLowerCase());
}

/** Replaces the value of every secret-looking `name=value` pair with `[redacted]`. */
export function redactSecrets(value: string): string {
  // Always consume a complete name run, even without '=', to avoid retrying
  // the same suffixes. Decode names once, like the HTTP query parser.
  const names = /[a-z0-9_%+.-]+/gi;
  const valueBoundary = /[&\s]/g;
  const parts: string[] = [];
  let copiedThrough = 0;
  let match: RegExpExecArray | null;
  while ((match = names.exec(value)) !== null) {
    if (value[names.lastIndex] !== "=" || !isSecretName(match[0])) continue;

    const valueStart = names.lastIndex + 1;
    valueBoundary.lastIndex = valueStart;
    const valueEnd = valueBoundary.exec(value)?.index ?? value.length;
    parts.push(value.slice(copiedThrough, valueStart), REDACTED);
    copiedThrough = valueEnd;
    names.lastIndex = valueEnd;
  }
  return parts.length === 0 ? value : parts.join("") + value.slice(copiedThrough);
}

/**
 * The legacy routes, whose whole query string is treated as secret: these are
 * the only endpoints that take credentials in the URL, and they are called by
 * hardware we cannot change, so a new parameter name could appear without us
 * knowing. Logging the path alone loses nothing we need.
 */
const LEGACY_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/index.php",
  "/spacestate.php",
  "/togglestate.php",
  "/togglebaker.php",
]);

export function isLegacyPath(path: string): boolean {
  path = path.replace(/^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|TRACE|CONNECT)[: ]+/i, "");
  try {
    path = decodeURIComponent(new URL(path, "http://redaction.invalid").pathname);
  } catch {
    // Keep a malformed path available for the exact matches below.
  }
  return LEGACY_PATHS.has(path) || path.endsWith(".php");
}

/**
 * Redacts a URL (absolute or path-only) for logging: the entire query string
 * on the legacy routes, the secret parameters everywhere else. The path is
 * always kept — it is what the logs are for.
 */
export function redactUrl(url: string): string {
  const separator = url.indexOf("?");
  if (separator === -1) return redactSecrets(url);
  const path = url.slice(0, separator);
  const query = url.slice(separator + 1);
  if (query.length === 0) return path;
  return isLegacyPath(path) ? `${path}?${REDACTED}` : `${path}?${redactSecrets(query)}`;
}

/** Sentry's `request.query_string`: a raw string, an object, or key/value pairs. */
export function redactQueryString<T>(queryString: T): T {
  if (typeof queryString === "string") return redactSecrets(queryString) as T;
  if (Array.isArray(queryString)) {
    return queryString.map((pair) =>
      Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && isSecretName(pair[0])
        ? [pair[0], REDACTED]
        : scrubValue(pair),
    ) as T;
  }
  return scrubValue(queryString) as T;
}

/** Attribute keys that hold a whole URL, so they get the legacy-path treatment. */
const URL_KEYS: ReadonlySet<string> = new Set([
  "url",
  "url.full",
  "url.path",
  "full_url",
  "http.url",
  "http.target",
  "request.url",
]);

/** Attribute keys that hold a bare query string. */
const QUERY_KEYS: ReadonlySet<string> = new Set([
  "query",
  "query_string",
  "url.query",
  "http.query",
  "http.query_string",
]);

const MAX_DEPTH = 8;

function lastSegment(key: string): string {
  const parts = key.split(".");
  return parts[parts.length - 1] ?? key;
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (value instanceof Error) {
    return scrubValue({ ...value, type: value.name, message: value.message, stack: value.stack, cause: value.cause }, depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [rawKey, inner] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (isSecretName(key) || isSecretName(lastSegment(key))) {
      out[rawKey] = REDACTED;
    } else if (typeof inner === "string" && URL_KEYS.has(key)) {
      out[rawKey] = redactUrl(inner);
    } else if (typeof inner === "string" && QUERY_KEYS.has(key)) {
      out[rawKey] = redactSecrets(inner);
    } else {
      out[rawKey] = scrubValue(inner, depth + 1);
    }
  }
  return out;
}

/**
 * Deep-scrubs an attribute bag: secret-named keys lose their value entirely,
 * URL- and query-named keys are redacted as URLs, and every other string has
 * its `token=…` pairs redacted. Overly deep object branches are replaced with
 * a redaction marker rather than returned without inspection.
 */
export function scrubAttributes<T extends object>(attributes: T): T {
  return scrubValue(attributes) as T;
}

/** Scrubs a Sentry log (`beforeSendLog`): message text and attributes. */
export function scrubSentryLog(log: Log): Log {
  return {
    ...log,
    message: redactSecrets(log.message) as Log["message"],
    attributes: log.attributes ? scrubAttributes(log.attributes) : log.attributes,
  };
}

/** Scrubs a Sentry breadcrumb (`beforeBreadcrumb`): message and `data`. */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    ...(breadcrumb.message === undefined ? {} : { message: redactSecrets(breadcrumb.message) }),
    ...(breadcrumb.data === undefined ? {} : { data: scrubAttributes(breadcrumb.data) }),
  };
}

/** Scrubs a span name and attributes (`beforeSendSpan`, and the spans on an event). */
export function scrubSpanFields<A extends object>(span: { name: string; attributes: A }): {
  name: string;
  attributes: A;
} {
  return { name: redactUrl(span.name), attributes: scrubAttributes(span.attributes) };
}

/**
 * Scrubs a Sentry event in place (`beforeSend`, `beforeSendTransaction`):
 * `request.url` / `request.query_string`, the transaction name, the message,
 * exception messages, tags, extra, contexts, breadcrumbs and child spans.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  if (typeof event.transaction === "string") event.transaction = redactUrl(event.transaction);
  if (typeof event.message === "string") event.message = redactSecrets(event.message);

  const request = event.request;
  if (request) {
    if (typeof request.url === "string") request.url = redactUrl(request.url);
    if (request.query_string !== undefined) request.query_string = redactQueryString(request.query_string);
    if (request.headers) request.headers = scrubAttributes(request.headers);
    if (request.data !== undefined) request.data = scrubValue(request.data);
  }

  if (event.tags) event.tags = scrubAttributes(event.tags);
  if (event.extra) event.extra = scrubAttributes(event.extra);
  if (event.contexts) event.contexts = scrubAttributes(event.contexts);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb);

  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = redactSecrets(exception.value);
  }

  if (event.spans) {
    for (const span of event.spans) {
      span.description = span.description === undefined ? span.description : redactUrl(span.description);
      if (span.data) span.data = scrubAttributes(span.data);
    }
  }

  return event;
}
