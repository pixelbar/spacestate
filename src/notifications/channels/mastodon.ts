import { z } from "zod";
import { channelBaseSchema, defineChannelType } from "../channel.js";
import { httpDeliveryError } from "../types.js";

const schema = channelBaseSchema.extend({
  type: z.literal("mastodon"),
  /** The account's home instance, e.g. https://mastodon.social. */
  instance: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), "must be an https:// URL")
    .transform((url) => url.replace(/\/+$/, "")),
  /** From Preferences → Development → New application, with only the write:statuses scope. */
  accessToken: z.string().min(1),
  visibility: z.enum(["public", "unlisted", "private", "direct"]).default("public"),
  /** ISO 639-1, e.g. "nl"; the instance guesses when unset. */
  language: z.string().regex(/^[a-z]{2}$/, "a two-letter ISO 639-1 code").optional(),
});

/** Mastodon answers errors with `{"error": "..."}`, which never echoes the token; keep it short for the logs. */
async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

/** Posts a status to a Mastodon account. */
export const mastodonChannel = defineChannelType({
  type: "mastodon",
  schema,
  create: (config, context) => ({
    deliver: async (notification, delivery) => {
      const response = await context.fetch(`${config.instance}/api/v1/statuses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          "content-type": "application/json",
          "user-agent": "pixelbar-spacestate",
          // Mastodon remembers this for an hour and answers a repeat with the
          // status it already made, so a retry after a lost response does not
          // post twice.
          "idempotency-key": delivery.id,
        },
        body: JSON.stringify({
          status: context.message(notification),
          visibility: config.visibility,
          ...(config.language ? { language: config.language } : {}),
        }),
        // An API post is never legitimately redirected; following one would carry the token along.
        redirect: "manual",
        signal: delivery.signal,
      });

      const error = httpDeliveryError(response.status, response.ok ? undefined : await errorDetail(response));
      void response.body?.cancel().catch(() => {});
      if (error) throw error;
    },
  }),
});
