import { load as parseYaml } from "js-yaml";
import * as Sentry from "@sentry/node";
import { spaceConfigSchema, type SpaceConfig } from "./schema.js";
import type { ConfigSource } from "./sources/types.js";

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Holds the current, validated space config and keeps it fresh by polling
 * the source on an interval. A reload failure logs and keeps serving the
 * last known-good config rather than taking the app down.
 */
export class ConfigStore {
  private current: SpaceConfig;
  private pollTimer: NodeJS.Timeout | undefined;

  private constructor(
    initial: SpaceConfig,
    private readonly source: ConfigSource,
    private readonly pollIntervalMs: number,
  ) {
    this.current = initial;
  }

  static async create(
    source: ConfigSource,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ): Promise<ConfigStore> {
    const initial = await ConfigStore.loadAndValidate(source);
    const store = new ConfigStore(initial, source, pollIntervalMs);
    store.startPolling();
    return store;
  }

  get(): SpaceConfig {
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
      this.current = await ConfigStore.loadAndValidate(this.source);
    } catch (err) {
      Sentry.logger.warn("Config reload failed; continuing to serve the last known-good config", {
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err);
    }
  }

  private static async loadAndValidate(source: ConfigSource): Promise<SpaceConfig> {
    const raw = await source.load();
    const parsed = parseYaml(raw);
    return spaceConfigSchema.parse(parsed);
  }
}
