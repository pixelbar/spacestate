import { z } from "zod";

const iconSchema = z.object({ open: z.string(), closed: z.string() });

/**
 * The static part of the public SpaceAPI document — exactly the JSON served
 * at spaceapi.pixelbar.nl minus the dynamic fields (`open`, `state.open`,
 * `state.lastchange`), which the builder fills in from live state.
 * Unknown keys are preserved so new SpaceAPI fields only need a config edit.
 */
export const spaceApiConfigSchema = z
  .object({
    api: z.string(),
    space: z.string(),
    logo: z.string(),
    url: z.string(),
    location: z.object({ address: z.string(), lon: z.number(), lat: z.number() }).passthrough(),
    contact: z.object({ email: z.string() }).passthrough(),
    spacefed: z.object({
      spacenet: z.boolean(),
      spacesaml: z.boolean(),
      spacephone: z.boolean(),
    }),
    icon: iconSchema,
    state: z.object({ icon: iconSchema }).passthrough(),
    issue_report_channels: z.array(z.string()),
    projects: z.array(z.string()),
  })
  .passthrough();

const apiKeyEntrySchema = z.object({
  id: z.string(),
  key: z.string().min(16, "API keys should be long enough to resist guessing"),
  role: z.enum(["read", "write"]),
});

const legacyDeviceSchema = z.object({
  shortname: z.string(),
  method: z.string(),
  ip: z.string(),
  token: z.string().min(1),
});

export const apiKeysConfigSchema = z.object({
  apiKeys: z.array(apiKeyEntrySchema).default([]),
});

export const legacyConfigSchema = z.object({
  legacyDevices: z.array(legacyDeviceSchema).default([]),
});

const webhookEntrySchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  /** HMAC-SHA256 key for signing deliveries; generated at registration. */
  secret: z.string().min(16),
  /** Free-form note from the registrant (who to contact when it breaks). */
  description: z.string().optional(),
  createdAt: z.string(),
  createdBy: z.string(),
});

export const webhooksConfigSchema = z.object({
  webhooks: z.array(webhookEntrySchema).default([]),
});

export type SpaceApiConfig = z.infer<typeof spaceApiConfigSchema>;
export type ApiKeysConfig = z.infer<typeof apiKeysConfigSchema>;
export type LegacyConfig = z.infer<typeof legacyConfigSchema>;
export type ApiKeyEntry = z.infer<typeof apiKeyEntrySchema>;
export type LegacyDevice = z.infer<typeof legacyDeviceSchema>;
export type WebhooksConfig = z.infer<typeof webhooksConfigSchema>;
export type WebhookEntry = z.infer<typeof webhookEntrySchema>;
