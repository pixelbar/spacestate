import { createHmac, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import type { WebhookEntry } from "../../config/schema.js";
import type { StateChangedEvent } from "../state/types.js";
import type { WebhookRegistry } from "./registry.js";
import { assertPublicTarget, type TargetPolicy } from "./targetPolicy.js";

const DEFAULT_TIMEOUT_MS = 5_000;
/** Waits before retries 1, 2 and 3 — four attempts in all. */
const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

export interface DispatcherOptions {
  policy: TargetPolicy;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelaysMs?: number[];
}

/** What receivers get as the JSON body. */
export interface WebhookPayload {
  event: "state.changed";
  /** Same across the retries of one delivery, so receivers can deduplicate. */
  deliveryId: string;
  state: StateChangedEvent["snapshot"]["state"];
  previousState: StateChangedEvent["previousState"];
  changedAt: string;
  changedBy: string;
  method: string;
  source: StateChangedEvent["snapshot"]["source"];
}

export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/**
 * Tells every registered webhook that the space state changed. Fire and
 * forget: `notify` returns immediately, so a slow or dead receiver can never
 * delay the response to whoever flipped the switch. Each webhook gets its own
 * delivery with a timeout and a few retries; the outcome is logged, never
 * thrown.
 *
 * Deliveries are not ordered across changes — a retry of an older change can
 * land after a newer one — so receivers should compare `changedAt`.
 */
export class WebhookDispatcher {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];
  private readonly inFlight = new Set<Promise<void>>();
  private closed = false;
  private readonly sleepers = new Set<() => void>();

  constructor(
    private readonly registry: WebhookRegistry,
    private readonly options: DispatcherOptions,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  notify(event: StateChangedEvent): void {
    if (this.closed) return;
    const { snapshot, previousState } = event;
    for (const webhook of this.registry.list()) {
      const payload: WebhookPayload = {
        event: "state.changed",
        deliveryId: randomUUID(),
        state: snapshot.state,
        previousState,
        changedAt: snapshot.changedAt,
        changedBy: snapshot.changedBy,
        method: snapshot.method,
        source: snapshot.source,
      };
      const delivery = this.deliver(webhook, payload).finally(() => this.inFlight.delete(delivery));
      this.inFlight.add(delivery);
    }
  }

  /** Resolves when every delivery in progress has finished (or given up). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /** Stop retrying, let attempts already on the wire finish. */
  async close(): Promise<void> {
    this.closed = true;
    for (const wakeUp of this.sleepers) wakeUp();
    await this.idle();
  }

  private async deliver(webhook: WebhookEntry, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const attempts = this.retryDelaysMs.length + 1;
    let lastError = "";

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const outcome = await this.attempt(webhook, payload, body);
      if (outcome.ok) {
        Sentry.logger.info("webhook delivered", { webhook: webhook.id, deliveryId: payload.deliveryId, attempt });
        return;
      }
      lastError = outcome.error;
      if (!outcome.retry || attempt === attempts || this.closed) break;
      await this.sleep(this.retryDelaysMs[attempt - 1]!);
      if (this.closed) break;
    }

    Sentry.logger.warn("webhook delivery failed", {
      webhook: webhook.id,
      deliveryId: payload.deliveryId,
      error: lastError,
    });
  }

  private async attempt(
    webhook: WebhookEntry,
    payload: WebhookPayload,
    body: string,
  ): Promise<{ ok: true } | { ok: false; retry: boolean; error: string }> {
    try {
      await assertPublicTarget(webhook.url, this.options.policy);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await this.fetchImpl(webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "pixelbar-spacestate-webhooks",
          "x-spacestate-event": payload.event,
          "x-spacestate-delivery": payload.deliveryId,
          "x-spacestate-timestamp": timestamp,
          "x-spacestate-signature": sign(webhook.secret, timestamp, body),
        },
        body,
        // A redirect could bounce the signed request to a host that was never
        // registered (or an internal one), so a 3xx counts as a failure.
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // Drain nothing: the response body is never read, and cancelling frees the socket.
      void response.body?.cancel().catch(() => {});

      if (response.status >= 200 && response.status < 300) return { ok: true };
      // 4xx means the receiver understood and said no: retrying won't change that.
      const retry = response.status >= 500 || response.status === 408 || response.status === 429;
      return { ok: false, retry, error: `HTTP ${response.status}` };
    } catch (err) {
      // The URL can hold a secret path segment, and undici errors may quote it.
      const reason = err instanceof Error ? err.name + (err.cause instanceof Error ? `: ${err.cause.message}` : "") : "error";
      return { ok: false, retry: true, error: reason };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.sleepers.add(done);
    });
  }
}
