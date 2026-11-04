import { createHmac } from "node:crypto";
import type { WebhookEntry } from "../../config/schema.js";
import { httpDeliveryError, type Delivery, type StateNotification, type Subscriber, type SubscriberSource } from "../types.js";
import { assertPublicTarget, type TargetPolicy } from "./targetPolicy.js";

/** Receivers must answer within this; documented in the OpenAPI spec. */
export const WEBHOOK_TIMEOUT_MS = 5_000;

/** What receivers get as the JSON body. */
export interface WebhookPayload extends StateNotification {
  event: "state.changed";
  /** Same across the retries of one delivery, so receivers can deduplicate. */
  deliveryId: string;
}

export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export interface WebhookSubscribersOptions {
  policy: TargetPolicy;
  fetch?: typeof fetch;
}

/**
 * Every registered webhook, as a subscriber: a signed JSON `POST` to its URL.
 * Read from the registry on each change, so a registration takes effect for
 * the next one.
 */
export class WebhookSubscribers implements SubscriberSource {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly registry: { list(): readonly WebhookEntry[] },
    private readonly options: WebhookSubscribersOptions,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  subscribers(): Subscriber[] {
    return this.registry.list().map((webhook) => ({
      id: `webhook:${webhook.id}`,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      deliver: (notification, delivery) => this.deliver(webhook, notification, delivery),
    }));
  }

  private async deliver(webhook: WebhookEntry, notification: StateNotification, delivery: Delivery): Promise<void> {
    await assertPublicTarget(webhook.url, this.options.policy);

    const payload: WebhookPayload = { event: "state.changed", deliveryId: delivery.id, ...notification };
    const body = JSON.stringify(payload);
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
      signal: delivery.signal,
    });
    // The response body is never read; cancelling it frees the socket.
    void response.body?.cancel().catch(() => {});

    const error = httpDeliveryError(response.status);
    if (error) throw error;
  }
}
