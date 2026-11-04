import * as Sentry from "@sentry/node";
import type { AnyChannelType, ChannelConfigBase } from "./channel.js";
import { CHANNEL_TYPES } from "./channels/index.js";
import type { NotificationsConfig } from "./config.js";
import { DEFAULT_MESSAGES, renderMessage, type MessageTemplates } from "./message.js";
import type { Subscriber, SubscriberSource } from "./types.js";

export interface ConfiguredChannelsOptions {
  /** The space's name for `{space}`, read at send time so a SpaceAPI config edit applies. */
  space: () => string;
  channelTypes?: readonly AnyChannelType[];
  fetch?: typeof fetch;
}

/**
 * The operator-configured channels in notifications.yaml, as subscribers.
 * Rebuilt whenever the store hands back a new document (a config reload), so
 * enabling a channel or rotating its token needs no restart.
 */
export class ConfiguredChannels implements SubscriberSource {
  private readonly byType: Map<string, AnyChannelType>;
  private readonly fetchImpl: typeof fetch;
  private built: { config: NotificationsConfig; subscribers: Subscriber[] } | undefined;

  constructor(
    private readonly store: { get(): NotificationsConfig },
    private readonly options: ConfiguredChannelsOptions,
  ) {
    this.byType = new Map((options.channelTypes ?? CHANNEL_TYPES).map((t) => [t.type, t]));
    this.fetchImpl = options.fetch ?? fetch;
  }

  subscribers(): readonly Subscriber[] {
    const config = this.store.get();
    if (this.built?.config !== config) this.built = { config, subscribers: this.build(config) };
    return this.built.subscribers;
  }

  private build(config: NotificationsConfig): Subscriber[] {
    const subscribers: Subscriber[] = [];
    for (const channel of config.channels) {
      if (!channel.enabled) continue;
      const id = `${channel.type}:${channel.id}`;
      try {
        subscribers.push(this.create(id, channel, config));
      } catch (err) {
        Sentry.logger.error("Notification channel could not be set up; it will not be notified", {
          subscriber: id,
          error: err instanceof Error ? err.message : String(err),
        });
        Sentry.captureException(err);
      }
    }
    return subscribers;
  }

  private create(id: string, channel: ChannelConfigBase, config: NotificationsConfig): Subscriber {
    const channelType = this.byType.get(channel.type);
    // The config schema already refused unknown types; this is the same registry.
    if (!channelType) throw new Error(`unknown channel type "${channel.type}"`);

    const templates: MessageTemplates = {
      ...DEFAULT_MESSAGES,
      ...channelType.defaultMessages,
      ...config.messages,
      ...channel.messages,
    };
    const subscriber = channelType.create(channel, {
      fetch: this.fetchImpl,
      message: (notification) =>
        renderMessage(templates[notification.state], notification, {
          space: this.options.space(),
          timeZone: config.timeZone,
        }),
    });
    return {
      id,
      timeoutMs: subscriber.timeoutMs,
      deliver: (notification, delivery) => subscriber.deliver(notification, delivery),
    };
  }
}
