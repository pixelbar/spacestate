import type { ChangeSource, SpaceState } from "../domain/state/types.js";

/** One recorded state change, as every subscriber sees it. */
export interface StateNotification {
  state: SpaceState;
  previousState: SpaceState;
  changedAt: string; // ISO timestamp
  changedBy: string;
  method: string;
  source: ChangeSource;
}

export interface Delivery {
  /**
   * Unique per notification and subscriber, and the same on every retry of
   * it: an idempotency key for receivers and APIs that accept one.
   */
  id: string;
  /** 1 for the first try. */
  attempt: number;
  /** Aborted when the attempt times out. Pass it to fetch, sockets, etc. */
  signal: AbortSignal;
}

/**
 * One place a notification goes: a webhook URL, a Mastodon account, a set of
 * IRC channels. The dispatcher owns timeouts, retries and ordering; a
 * subscriber only makes one attempt per `deliver` call.
 */
export interface Subscriber {
  /**
   * Stable, unique and free of secrets, because it is logged: conventionally
   * `<type>:<id>`, e.g. `mastodon:pixelbar` or `webhook:wh_3f9a1c2b7d4e`.
   */
  readonly id: string;
  /** Time limit for one attempt, when the dispatcher's default does not fit. */
  readonly timeoutMs?: number;
  /**
   * Resolve when delivered. Throw to fail the attempt: a `DeliveryError` with
   * `retryable: false` for a rejection that retrying cannot fix, anything
   * else to be retried.
   */
  deliver(notification: StateNotification, delivery: Delivery): Promise<void>;
}

/**
 * Where subscribers come from. Asked on every notification, so the set can
 * change at runtime: a config reload, a webhook registered through the API.
 */
export interface SubscriberSource {
  subscribers(): readonly Subscriber[];
}

/**
 * A failed attempt whose message is safe to log: subscribers build it
 * themselves, so it never quotes a token or a secret URL. Errors of any other
 * type are logged by name only.
 */
export class DeliveryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, { retryable }: { retryable: boolean }) {
    super(message);
    this.name = "DeliveryError";
    this.retryable = retryable;
  }
}

/**
 * The usual reading of an HTTP status for a delivery: 2xx is success; 408,
 * 429 and 5xx are worth retrying; anything else (including a 3xx, as
 * redirects are not followed) is the receiver saying no.
 */
export function httpDeliveryError(status: number, detail?: string): DeliveryError | undefined {
  if (status >= 200 && status < 300) return undefined;
  const retryable = status >= 500 || status === 408 || status === 429;
  return new DeliveryError(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`, { retryable });
}
