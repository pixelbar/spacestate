import { z } from "zod";
import { messagesSchema, type MessageTemplates } from "./message.js";
import type { StateNotification, Subscriber } from "./types.js";

/**
 * The fields every entry under `channels:` in notifications.yaml has. A
 * channel type's schema extends this with `type: z.literal("<its type>")`
 * and whatever it needs to connect (instance URL, tokens, server, ...).
 */
export const channelBaseSchema = z.object({
  type: z.string(),
  /** Names the channel in logs as `<type>:<id>`, so keep secrets out of it. */
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "use lowercase letters, digits, - and _"),
  /** Set to false to keep an entry (and its credentials) without posting. */
  enabled: z.boolean().default(true),
  /** Overrides the document's `messages` for this channel only. */
  messages: messagesSchema.optional(),
});

export type ChannelConfigBase = z.infer<typeof channelBaseSchema>;

export interface ChannelContext {
  /** This channel's text for a notification, rendered from its templates. */
  message(notification: StateNotification): string;
  fetch: typeof fetch;
}

/** A subscriber minus its id, which is derived from the config entry. */
export type ChannelSubscriber = Omit<Subscriber, "id">;

/**
 * A kind of operator-configured notification target (Mastodon, IRC, ...).
 * Adding one is a module that exports a ChannelType and a line in
 * channels/index.ts; the config schema, `just edit notifications` validation
 * and delivery all pick it up from there.
 */
export interface ChannelType<C extends ChannelConfigBase = ChannelConfigBase> {
  type: string;
  /** Validates one whole entry, base fields included. */
  schema: z.ZodType<C>;
  /** Used where neither the channel nor the document sets a template. */
  defaultMessages?: Partial<MessageTemplates>;
  /** Builds the subscriber for one enabled entry. Called again after every config reload. */
  create(config: C, context: ChannelContext): ChannelSubscriber;
}

// `any`: the registry holds channel types with different config shapes, and
// each is only ever handed entries its own schema produced.
export type AnyChannelType = ChannelType<any>;

/** Identity function that infers `C` from the schema. */
export function defineChannelType<C extends ChannelConfigBase>(channelType: ChannelType<C>): ChannelType<C> {
  return channelType;
}
