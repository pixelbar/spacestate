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
  ) {
    this.current = initial;
  }

  static async create<T>(
    source: ConfigSource,
    parse: ConfigParser<T>,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ): Promise<ConfigStore<T>> {
    const initial = parse(await source.load());
    const store = new ConfigStore(initial, source, parse, pollIntervalMs);
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
      Sentry.logger.warn("Config reload failed; continuing to serve the last known-good config", {
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err);
    }
  }
}
