import { load as parseYaml } from "js-yaml";
import * as Sentry from "@sentry/node";
import type { ZodType } from "zod";
import type { ConfigSource } from "./sources/types.js";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Parses raw source text (YAML or JSON — JSON is valid YAML) into a validated value. */
export type ConfigParser<T> = (raw: string) => T;

export function yamlParser<T>(schema: ZodType<T>): ConfigParser<T> {
  return (raw) => schema.parse(parseYaml(raw));
}

export interface ConfigStoreOptions<T> {
  pollIntervalMs?: number;
  /**
   * Makes the document optional: if the first load fails (missing, unreadable
   * or invalid), start from this value instead of throwing, and keep polling
   * so the real document is picked up once it appears. For side features
   * that must never stop the space state from being served.
   */
  fallback?: T;
}

/** ENOENT from the file source, 404 from the blob source. */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; statusCode?: unknown };
  return e?.code === "ENOENT" || e?.statusCode === 404;
}

/**
 * Holds one current, validated config document and keeps it fresh by polling
 * the source on an interval. A reload failure logs and keeps serving the
 * last known-good config rather than taking the app down.
 */
export class ConfigStore<T> {
  private current: T;
  private pollTimer: NodeJS.Timeout | undefined;

  private constructor(
    initial: T,
    private readonly source: ConfigSource,
    private readonly parse: ConfigParser<T>,
    private readonly pollIntervalMs: number,
    private readonly optional: boolean,
  ) {
    this.current = initial;
  }

  static async create<T>(
    source: ConfigSource,
    parse: ConfigParser<T>,
    { pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, fallback }: ConfigStoreOptions<T> = {},
  ): Promise<ConfigStore<T>> {
    let initial: T;
    try {
      initial = parse(await source.load());
    } catch (err) {
      if (fallback === undefined) throw err;
      initial = fallback;
      if (isNotFound(err)) {
        Sentry.logger.info("Optional config document not found; using its default until it appears");
      } else {
        Sentry.logger.warn("Optional config document failed to load; using its default until it is fixed", {
          error: err instanceof Error ? err.message : String(err),
        });
        Sentry.captureException(err);
      }
    }
    const store = new ConfigStore(initial, source, parse, pollIntervalMs, fallback !== undefined);
    store.startPolling();
    return store;
  }

  get(): T {
    return this.current;
  }

  async close(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private startPolling(): void {
    if (this.pollIntervalMs <= 0) return;
    this.pollTimer = setInterval(() => {
      void this.reload();
    }, this.pollIntervalMs);
    this.pollTimer.unref();
  }

  private async reload(): Promise<void> {
    try {
      this.current = this.parse(await this.source.load());
    } catch (err) {
      // An optional document that was never uploaded is not an error worth a report every poll.
      if (this.optional && isNotFound(err)) return;
      Sentry.logger.warn("Config reload failed; continuing to serve the last known-good config", {
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err);
    }
  }
}
