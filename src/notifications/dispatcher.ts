import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import type { StateChangedEvent } from "../domain/state/types.js";
import { DeliveryError, type StateNotification, type Subscriber, type SubscriberSource } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
/** Waits before retries 1, 2 and 3 — four attempts in all. */
const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

export interface DispatcherOptions {
  /** Per attempt, for subscribers that don't set their own. */
  timeoutMs?: number;
  retryDelaysMs?: number[];
}

type Outcome = { ok: true } | { ok: false; retry: boolean; error: string };

/**
 * Tells every subscriber, from every source, that the space state changed.
 *
 * Fire and forget: `notify` returns immediately, so a slow or dead receiver
 * can never delay the response to whoever flipped the switch. Each subscriber
 * gets its own delivery with a timeout and a few retries; the outcome is
 * logged, never thrown, and one subscriber failing does not affect another.
 *
 * Deliveries to one subscriber are made in order: a change is not sent until
 * the previous one has been delivered or given up on. Otherwise a retried
 * "open" could be posted after the "closed" that followed it, and two quick
 * changes would race for the same IRC nick.
 */
export class NotificationDispatcher {
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];
  /** The tail of each subscriber's queue, by subscriber id. */
  private readonly queues = new Map<string, Promise<void>>();
  private readonly sleepers = new Set<() => void>();
  private closed = false;

  constructor(
    private readonly sources: readonly SubscriberSource[],
    options: DispatcherOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  notify({ snapshot, previousState }: StateChangedEvent): void {
    if (this.closed) return;
    const notification: StateNotification = {
      state: snapshot.state,
      previousState,
      changedAt: snapshot.changedAt,
      changedBy: snapshot.changedBy,
      method: snapshot.method,
      source: snapshot.source,
    };

    for (const subscriber of this.subscribers()) {
      const deliveryId = randomUUID();
      const previous = this.queues.get(subscriber.id) ?? Promise.resolve();
      // deliver() never rejects, so the chain cannot break.
      const tail = previous.then(() => this.deliver(subscriber, notification, deliveryId));
      this.queues.set(subscriber.id, tail);
      void tail.then(() => {
        if (this.queues.get(subscriber.id) === tail) this.queues.delete(subscriber.id);
      });
    }
  }

  /** Resolves when every queued delivery has finished (or been given up on). */
  async idle(): Promise<void> {
    while (this.queues.size > 0) await Promise.allSettled([...this.queues.values()]);
  }

  /** Stop retrying and drop what is still queued; let attempts already under way finish. */
  async close(): Promise<void> {
    this.closed = true;
    for (const wakeUp of this.sleepers) wakeUp();
    await this.idle();
  }

  private subscribers(): Subscriber[] {
    const all: Subscriber[] = [];
    for (const source of this.sources) {
      try {
        all.push(...source.subscribers());
      } catch (err) {
        // One broken source (say, a channel whose config cannot be built) must not silence the others.
        Sentry.logger.error("Notification subscriber source failed; skipping it for this change", {
          error: err instanceof Error ? err.message : String(err),
        });
        Sentry.captureException(err);
      }
    }
    return all;
  }

  private async deliver(subscriber: Subscriber, notification: StateNotification, deliveryId: string): Promise<void> {
    const context = { subscriber: subscriber.id, deliveryId, state: notification.state };
    if (this.closed) {
      Sentry.logger.warn("Notification dropped: shutting down before it was sent", context);
      return;
    }

    const attempts = this.retryDelaysMs.length + 1;
    let lastError = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const outcome = await this.attempt(subscriber, notification, deliveryId, attempt);
      if (outcome.ok) {
        Sentry.logger.info("Notification delivered", { ...context, attempt });
        return;
      }
      lastError = outcome.error;
      if (!outcome.retry || attempt === attempts || this.closed) break;
      Sentry.logger.info("Notification attempt failed; retrying", { ...context, attempt, error: outcome.error });
      await this.sleep(this.retryDelaysMs[attempt - 1]!);
      if (this.closed) break;
    }

    Sentry.logger.warn("Notification delivery failed", { ...context, error: lastError });
  }

  private async attempt(
    subscriber: Subscriber,
    notification: StateNotification,
    deliveryId: string,
    attempt: number,
  ): Promise<Outcome> {
    const timeoutMs = subscriber.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    // Raced rather than trusted to the subscriber, so one that ignores its
    // signal still cannot hold its queue forever.
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DeliveryError(`timed out after ${timeoutMs} ms`, { retryable: true }));
      }, timeoutMs);
    });

    try {
      await Promise.race([
        subscriber.deliver(notification, { id: deliveryId, attempt, signal: controller.signal }),
        timedOut,
      ]);
      return { ok: true };
    } catch (err) {
      if (err instanceof DeliveryError) return { ok: false, retry: err.retryable, error: err.message };
      // Anything else may quote a URL with a secret in it (undici errors do), so log its name and cause only.
      const reason = err instanceof Error ? err.name + (err.cause instanceof Error ? `: ${err.cause.message}` : "") : "error";
      return { ok: false, retry: true, error: reason };
    } finally {
      clearTimeout(timer);
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
