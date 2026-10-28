import { z } from "zod";
import { channelBaseSchema, defineChannelType } from "../channel.js";
import { httpDeliveryError } from "../types.js";
import { oauth1Header } from "./oauth1.js";

const POST_URL = "https://api.x.com/2/tweets";

const schema = channelBaseSchema.extend({
  type: z.literal("twitter"),
  /** The app's API key and secret, from the X developer portal. */
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
  /** The posting account's access token and secret, generated with Read and Write permission. */
  accessToken: z.string().min(1),
  accessTokenSecret: z.string().min(1),
});

/** X's v2 problem responses carry `detail` (or `title`); neither echoes credentials. */
async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: unknown; title?: unknown };
    const detail = typeof body.detail === "string" ? body.detail : typeof body.title === "string" ? body.title : undefined;
    return detail?.slice(0, 200);
  } catch {
    return undefined;
  }
}

/**
 * Posts to an X (Twitter) account through the v2 API, signed with OAuth 1.0a
 * user context — the only flow that posts as an account without storing
 * refresh tokens that rotate on every use.
 *
 * X refuses a post identical to a recent one (403, "duplicate content"), and
 * the space opens and closes most days, so the default messages carry the
 * time. The same rule means a retry after a lost response is refused rather
 * than posted twice: there is no idempotency key.
 */
export const twitterChannel = defineChannelType({
  type: "twitter",
  schema,
  defaultMessages: { open: "{space} opened at {time}.", closed: "{space} closed at {time}." },
  create: (config, context) => ({
    deliver: async (notification, delivery) => {
      const response = await context.fetch(POST_URL, {
        method: "POST",
        headers: {
          authorization: oauth1Header("POST", POST_URL, config),
          "content-type": "application/json",
          "user-agent": "pixelbar-spacestate",
        },
        body: JSON.stringify({ text: context.message(notification) }),
        redirect: "manual",
        signal: delivery.signal,
      });

      const error = httpDeliveryError(response.status, response.ok ? undefined : await errorDetail(response));
      void response.body?.cancel().catch(() => {});
      if (error) throw error;
    },
  }),
});
