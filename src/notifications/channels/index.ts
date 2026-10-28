import type { AnyChannelType } from "../channel.js";
import { mastodonChannel } from "./mastodon.js";

/** Every channel type notifications.yaml can name under `channels:`. */
export const CHANNEL_TYPES: readonly AnyChannelType[] = [mastodonChannel];
