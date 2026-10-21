import { randomBytes } from "node:crypto";
import { dump, load } from "js-yaml";
import * as Sentry from "@sentry/node";
import { webhooksConfigSchema, type WebhookEntry, type WebhooksConfig } from "../../config/schema.js";
import { ConfigConflictError, type WritableConfigSource } from "../../config/sources/types.js";

const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
const MAX_WRITE_ATTEMPTS = 5;
/** Per owner, so one key cannot fill the registry for the others. */
export const MAX_WEBHOOKS_PER_OWNER = 20;

const FILE_HEADER = "# Webhooks registered via POST /api/v1/webhooks. Managed by the app; safe to edit by hand (`just edit webhooks`).\n";

export interface RegisterInput {
  url: string;
  description?: string;
  createdBy: string;
}

export type RegisterResult =
  | { kind: "created"; webhook: WebhookEntry }
  | { kind: "duplicate"; existing: WebhookEntry }
  | { kind: "limit" };

function parse(text: string | undefined): WebhooksConfig {
  return webhooksConfigSchema.parse(text === undefined ? {} : (load(text) ?? {}));
}

/**
 * The registered webhooks, persisted as a YAML document (a blob in
 * production). Unlike the other config stores this one is written by the app:
 * every change is a read-modify-write conditioned on the document's version,
 * retried on conflict, so replicas registering at the same moment cannot lose
 * each other's entries. Reads come from a copy refreshed every minute and
 * after each local write, so a webhook registered on one replica starts
 * receiving deliveries from the others within about a minute.
 */
export class WebhookRegistry {
  private current: WebhooksConfig = { webhooks: [] };
  private pollTimer: NodeJS.Timeout | undefined;

  private constructor(
    private readonly source: WritableConfigSource,
    private readonly pollIntervalMs: number,
  ) {}

  static async create(
    source: WritableConfigSource,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ): Promise<WebhookRegistry> {
    const registry = new WebhookRegistry(source, pollIntervalMs);
    // Webhooks are a side feature: an unreachable or malformed document must
    // not stop the space state from being served. Start empty and keep
    // retrying; writes re-read the document themselves, so nothing is lost.
    await registry.reload();
    if (pollIntervalMs > 0) {
      registry.pollTimer = setInterval(() => void registry.reload(), pollIntervalMs);
      registry.pollTimer.unref();
    }
    return registry;
  }

  /** Every webhook, for delivery. API callers must use `listOwnedBy`. */
  list(): WebhookEntry[] {
    return this.current.webhooks;
  }

  listOwnedBy(owner: string): WebhookEntry[] {
    return this.current.webhooks.filter((w) => w.createdBy === owner);
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    return this.mutate((config) => {
      // Duplicates and limits are judged within the owner's own webhooks: another
      // key's registrations must not be visible through them.
      const owned = config.webhooks.filter((w) => w.createdBy === input.createdBy);
      const existing = owned.find((w) => w.url === input.url);
      if (existing) return { kind: "duplicate", existing };
      if (owned.length >= MAX_WEBHOOKS_PER_OWNER) return { kind: "limit" };

      const webhook: WebhookEntry = {
        id: `wh_${randomBytes(6).toString("hex")}`,
        url: input.url,
        secret: randomBytes(32).toString("base64url"),
        ...(input.description ? { description: input.description } : {}),
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy,
      };
      config.webhooks.push(webhook);
      return { kind: "created", webhook };
    });
  }

  /** Returns false if the owner has no webhook with that id (including ones that belong to someone else). */
  async remove(id: string, owner: string): Promise<boolean> {
    return this.mutate((config) => {
      const index = config.webhooks.findIndex((w) => w.id === id && w.createdBy === owner);
      if (index === -1) return false;
      config.webhooks.splice(index, 1);
      return true;
    });
  }

  close(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async mutate<R>(change: (config: WebhooksConfig) => R): Promise<R> {
    for (let attempt = 1; ; attempt++) {
      const { text, version } = await this.source.loadVersioned();
      const config = parse(text);
      const before = JSON.stringify(config);
      const result = change(config);
      if (JSON.stringify(config) === before) {
        this.current = config;
        return result;
      }
      try {
        await this.source.save(FILE_HEADER + dump(config, { lineWidth: -1 }), version);
        this.current = config;
        return result;
      } catch (err) {
        if (!(err instanceof ConfigConflictError) || attempt >= MAX_WRITE_ATTEMPTS) throw err;
      }
    }
  }

  private async reload(): Promise<void> {
    try {
      this.current = parse((await this.source.loadVersioned()).text);
    } catch (err) {
      Sentry.logger.warn("Webhook registry reload failed; continuing with the last known list", {
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err);
    }
  }
}
