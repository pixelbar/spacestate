import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { channelBaseSchema, defineChannelType } from "../../src/notifications/channel.js";
import { notificationsConfigSchema, notificationsConfigSchemaFor, type NotificationsConfig } from "../../src/notifications/config.js";
import { ConfiguredChannels } from "../../src/notifications/configuredChannels.js";
import { renderMessage } from "../../src/notifications/message.js";
import type { Delivery, StateNotification } from "../../src/notifications/types.js";

const sent: Array<{ channel: string; text: string }> = [];

const echoType = defineChannelType({
  type: "echo",
  schema: channelBaseSchema.extend({ type: z.literal("echo"), target: z.string().min(1) }),
  create: (config, context) => ({
    timeoutMs: 1234,
    deliver: async (notification) => {
      sent.push({ channel: config.target, text: context.message(notification) });
    },
  }),
});

const loudType = defineChannelType({
  type: "loud",
  schema: channelBaseSchema.extend({ type: z.literal("loud") }),
  defaultMessages: { open: "{space} IS OPEN" },
  create: (_config, context) => ({
    deliver: async (notification) => {
      sent.push({ channel: "loud", text: context.message(notification) });
    },
  }),
});

const schema = notificationsConfigSchemaFor([echoType, loudType]);

const notification: StateNotification = {
  state: "open",
  previousState: "closed",
  changedAt: "2026-07-01T17:05:00.000Z",
  changedBy: "alice",
  method: "Spacestate Switch",
  source: "legacy",
};
const delivery: Delivery = { id: "d", attempt: 1, signal: new AbortController().signal };

function issues(input: unknown): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("notifications config", () => {
  it("defaults to no channels in Amsterdam", () => {
    expect(schema.parse({})).toEqual({ timeZone: "Europe/Amsterdam", channels: [] });
  });

  it("validates each channel with its own type's schema and applies its defaults", () => {
    const config = schema.parse({ channels: [{ type: "echo", id: "one", target: "#a" }] });
    expect(config.channels).toEqual([{ type: "echo", id: "one", target: "#a", enabled: true }]);
  });

  it("points at the field that is wrong", () => {
    expect(issues({ channels: [{ type: "echo", id: "ok", target: "#a" }, { type: "echo", id: "two" }] })).toEqual([
      expect.stringMatching(/^channels\.1\.target: /),
    ]);
  });

  it("refuses unknown types, naming the known ones", () => {
    expect(issues({ channels: [{ type: "fax", id: "x" }] })).toEqual([
      'channels.0.type: unknown channel type "fax" (known: echo, loud)',
    ]);
  });

  it("refuses duplicate ids", () => {
    expect(
      issues({
        channels: [
          { type: "echo", id: "same", target: "#a" },
          { type: "loud", id: "same" },
        ],
      }),
    ).toEqual(['channels.1.id: duplicate channel id "same"']);
  });

  it("refuses ids that would be awkward in logs", () => {
    expect(issues({ channels: [{ type: "loud", id: "Has Spaces" }] })).toHaveLength(1);
  });

  it("refuses unknown placeholders and time zones", () => {
    expect(issues({ messages: { open: "{space} is {stat}" } })).toEqual([
      expect.stringMatching(/^messages\.open: unknown placeholder \{stat\}/),
    ]);
    expect(issues({ timeZone: "Mars/Olympus_Mons" })).toEqual([expect.stringMatching(/^timeZone: /)]);
  });

  it("accepts the checked-in sample", () => {
    const sample = load(readFileSync("config/notifications.sample.yaml", "utf8"));
    expect(() => notificationsConfigSchema.parse(sample)).not.toThrow();
  });
});

describe("renderMessage", () => {
  const context = { space: "Pixelbar", timeZone: "Europe/Amsterdam" };

  it("fills every placeholder, in the configured time zone", () => {
    const text = renderMessage("{space} {state} {previousState} {changedBy} {method} {date} {time}", notification, context);
    // 17:05 UTC is 19:05 in Amsterdam summer time.
    expect(text).toBe("Pixelbar open closed alice Spacestate Switch 2026-07-01 19:05");
  });

  it("uses a 24-hour clock with midnight as 00", () => {
    const text = renderMessage("{date} {time}", { ...notification, changedAt: "2026-01-14T23:30:00.000Z" }, context);
    expect(text).toBe("2026-01-15 00:30");
  });
});

describe("ConfiguredChannels", () => {
  const space = () => "Pixelbar";

  function storeOf(input: unknown) {
    const store = { config: schema.parse(input) as NotificationsConfig, get: () => store.config };
    return store;
  }

  it("builds a subscriber per enabled channel, named <type>:<id>", () => {
    const store = storeOf({
      channels: [
        { type: "echo", id: "on", target: "#a" },
        { type: "echo", id: "off", target: "#b", enabled: false },
        { type: "loud", id: "shout" },
      ],
    });
    const channels = new ConfiguredChannels(store, { space, channelTypes: [echoType, loudType] });
    const subscribers = channels.subscribers();
    expect(subscribers.map((s) => s.id)).toEqual(["echo:on", "loud:shout"]);
    expect(subscribers[0]!.timeoutMs).toBe(1234);
  });

  it("layers templates: channel, then document, then the type's default, then the global default", async () => {
    sent.length = 0;
    const store = storeOf({
      messages: { closed: "doc: {space} closed" },
      channels: [
        { type: "echo", id: "plain", target: "plain" },
        { type: "echo", id: "custom", target: "custom", messages: { open: "custom: {space} open at {time}" } },
        { type: "loud", id: "loud" },
      ],
    });
    const channels = new ConfiguredChannels(store, { space, channelTypes: [echoType, loudType] });
    for (const subscriber of channels.subscribers()) {
      await subscriber.deliver(notification, delivery);
      await subscriber.deliver({ ...notification, state: "closed", previousState: "open" }, delivery);
    }
    expect(sent).toEqual([
      { channel: "plain", text: "Pixelbar is open." },
      { channel: "plain", text: "doc: Pixelbar closed" },
      { channel: "custom", text: "custom: Pixelbar open at 19:05" },
      { channel: "custom", text: "doc: Pixelbar closed" },
      { channel: "loud", text: "Pixelbar IS OPEN" },
      { channel: "loud", text: "doc: Pixelbar closed" },
    ]);
  });

  it("rebuilds only when the store hands back a new document", () => {
    const store = storeOf({ channels: [{ type: "loud", id: "a" }] });
    const channels = new ConfiguredChannels(store, { space, channelTypes: [echoType, loudType] });
    const first = channels.subscribers();
    expect(channels.subscribers()).toBe(first);

    store.config = schema.parse({ channels: [{ type: "loud", id: "a" }, { type: "loud", id: "b" }] });
    expect(channels.subscribers().map((s) => s.id)).toEqual(["loud:a", "loud:b"]);
  });

  it("skips a channel whose subscriber cannot be built, keeping the rest", () => {
    const create = vi.fn(() => {
      throw new Error("bad config");
    });
    const brokenType = { ...loudType, type: "broken", schema: channelBaseSchema.extend({ type: z.literal("broken") }), create };
    const both = notificationsConfigSchemaFor([brokenType, loudType]);
    const config = both.parse({ channels: [{ type: "broken", id: "x" }, { type: "loud", id: "y" }] });
    const channels = new ConfiguredChannels({ get: () => config }, { space, channelTypes: [brokenType, loudType] });
    expect(channels.subscribers().map((s) => s.id)).toEqual(["loud:y"]);
    expect(create).toHaveBeenCalledOnce();
  });
});
