import type { AnyChannelType } from "../channel.js";
import { ircChannel } from "./irc.js";
import { mastodonChannel } from "./mastodon.js";
import { twitterChannel } from "./twitter.js";

/** Every channel type notifications.yaml can name under `channels:`. */
export const CHANNEL_TYPES: readonly AnyChannelType[] = [mastodonChannel, twitterChannel, ircChannel];
