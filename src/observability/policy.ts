/**
 * What is worth reporting, in one place. Imports nothing, so sentry.ts can use
 * it before Sentry patches the modules it instruments (see index.ts).
 *
 * Most of this service's traffic is polling: dashboards and the SpaceAPI
 * directory fetch the current state every few seconds, all day, and scanners
 * probe paths that don't exist. That traffic is counted (`legacy.hits`,
 * sampled traces) rather than logged a line at a time. Requests that change
 * or query something — a toggle, a state write, a history read — are rare,
 * and each one is traced and logged.
 *
 * `LOG_LEVEL=debug` brings the per-request lines back, in stdout and in
 * Sentry Logs alike, for when you need them.
 */

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * The minimum level that is logged, from `LOG_LEVEL` (default `info`). It
 * applies to pino (stdout, and Sentry Logs through `pinoIntegration`) and to
 * direct `Sentry.logger.*` calls, so the two never disagree.
 *
 * Throws on an unknown level, as pino itself would.
 */
export function logLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env.LOG_LEVEL?.trim().toLowerCase() || "info";
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${env.LOG_LEVEL}"`);
  }
  return raw as LogLevel;
}

/** Whether a log at `level` passes `threshold`. Levels this module doesn't know always pass. */
export function isLevelEnabled(level: string, threshold: LogLevel): boolean {
  const rank = (LOG_LEVELS as readonly string[]).indexOf(level);
  return rank === -1 || rank >= LOG_LEVELS.indexOf(threshold);
}

/**
 * Requests where each one matters: state changes (legacy toggles and
 * `POST /api/v1/state`) and history reads. Everything else is routine.
 */
export function isNotableRequest(method: string | undefined, path: string): boolean {
  switch (path) {
    case "/togglestate.php":
    case "/togglebaker.php":
    case "/api/v1/history":
      return true;
    case "/api/v1/state":
      return method !== undefined && method !== "GET" && method !== "HEAD";
    default:
      return false;
  }
}
