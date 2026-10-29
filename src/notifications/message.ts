import { z } from "zod";
import type { StateNotification } from "./types.js";

/**
 * What a message template may refer to, as `{name}`:
 *   space          the SpaceAPI `space` name, e.g. "Pixelbar"
 *   state          open | closed
 *   previousState  open | closed
 *   changedBy      who changed it (the `user` of the request) — public on most channels, so opt in deliberately
 *   method         how, e.g. "Spacestate Switch"
 *   time, date     when, as HH:mm and YYYY-MM-DD in the configured time zone
 */
export const PLACEHOLDERS = ["space", "state", "previousState", "changedBy", "method", "time", "date"] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

export const templateSchema = z
  .string()
  .min(1)
  .superRefine((template, ctx) => {
    for (const [, name] of template.matchAll(PLACEHOLDER_PATTERN)) {
      if (!(PLACEHOLDERS as readonly string[]).includes(name!)) {
        ctx.addIssue({
          code: "custom",
          message: `unknown placeholder {${name}}; use one of ${PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}`,
        });
      }
    }
  });

/** A template per state. Partial wherever it can be layered over defaults. */
export const messagesSchema = z.object({ open: templateSchema, closed: templateSchema }).partial();

export type MessageTemplates = { open: string; closed: string };

export const DEFAULT_MESSAGES: MessageTemplates = {
  open: "{space} is open.",
  closed: "{space} is closed.",
};

export const timeZoneSchema = z.string().refine(
  (zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  },
  { message: "not a time zone known to Intl, e.g. Europe/Amsterdam" },
);

export interface RenderContext {
  space: string;
  timeZone: string;
}

export function renderMessage(template: string, notification: StateNotification, context: RenderContext): string {
  const at = new Date(notification.changedAt);
  // en-CA formats dates as YYYY-MM-DD; hourCycle h23 avoids "24:05" at midnight.
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: context.timeZone, dateStyle: "short" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: context.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);

  const values: Record<Placeholder, string> = {
    space: context.space,
    state: notification.state,
    previousState: notification.previousState,
    changedBy: notification.changedBy,
    method: notification.method,
    time,
    date,
  };
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => values[name as Placeholder] ?? match);
}
