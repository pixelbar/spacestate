import { z } from "zod";
import type { AnyChannelType, ChannelConfigBase } from "./channel.js";
import { CHANNEL_TYPES } from "./channels/index.js";
import { messagesSchema, timeZoneSchema } from "./message.js";

/**
 * notifications.yaml: where the space announces state changes. Edited by an
 * operator (`just edit notifications`) and only read by the app, like
 * api-keys.yaml — and like it, it holds secrets (access tokens, passwords).
 *
 *   timeZone: Europe/Amsterdam      # for {time} and {date}
 *   messages:                       # optional; per-channel `messages` override it
 *     open: "{space} is open."
 *     closed: "{space} is closed."
 *   channels:
 *     - type: mastodon              # one of CHANNEL_TYPES
 *       id: pixelbar
 *       ...                         # whatever that type needs
 *
 * Each entry is validated by its own type's schema, so a typo in a Mastodon
 * token field is caught by `just edit` rather than at the next state change.
 */
export function notificationsConfigSchemaFor(channelTypes: readonly AnyChannelType[]) {
  const byType = new Map(channelTypes.map((channelType) => [channelType.type, channelType]));
  const known = channelTypes.length > 0 ? channelTypes.map((t) => t.type).join(", ") : "none yet";

  const channelsSchema = z
    .array(z.object({ type: z.string() }).passthrough())
    .transform((entries, ctx) => {
      const channels: ChannelConfigBase[] = [];
      const ids = new Set<string>();
      entries.forEach((entry, index) => {
        const channelType = byType.get(entry.type);
        if (!channelType) {
          ctx.addIssue({ code: "custom", path: [index, "type"], message: `unknown channel type "${entry.type}" (known: ${known})` });
          return;
        }
        const parsed = channelType.schema.safeParse(entry);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [index, ...issue.path] } as never);
          return;
        }
        // Ids name subscribers in logs and order their deliveries, so they must be unique.
        if (ids.has(parsed.data.id)) {
          ctx.addIssue({ code: "custom", path: [index, "id"], message: `duplicate channel id "${parsed.data.id}"` });
          return;
        }
        ids.add(parsed.data.id);
        channels.push(parsed.data);
      });
      return channels;
    });

  return z.object({
    timeZone: timeZoneSchema.default("Europe/Amsterdam"),
    messages: messagesSchema.optional(),
    channels: channelsSchema.default([]),
  });
}

export const notificationsConfigSchema = notificationsConfigSchemaFor(CHANNEL_TYPES);

export type NotificationsConfig = z.infer<typeof notificationsConfigSchema>;

/** What a deployment without notifications.yaml runs with. */
export const NO_NOTIFICATIONS: NotificationsConfig = { timeZone: "Europe/Amsterdam", channels: [] };
