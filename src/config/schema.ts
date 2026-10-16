import { z } from "zod";

const keymasterSchema = z.object({
  name: z.string(),
  irc_nick: z.string().optional(),
  twitter: z.string().optional(),
  email: z.string().optional(),
});

const spaceMetadataSchema = z.object({
  name: z.string(),
  logo: z.string(),
  url: z.string(),
  address: z.string(),
  location: z.object({
    lon: z.number(),
    lat: z.number(),
  }),
  contact: z.object({
    email: z.string(),
    irc: z.string().optional(),
    discord: z.string().optional(),
    twitter: z.string().optional(),
    mastodon: z.string().optional(),
    ml: z.string().optional(),
  }),
  github: z.string().optional(),
  keymasters: z.array(keymasterSchema).default([]),
  // Whether this space participates in SpaceFed federation schemes. Real,
  // space-specific facts (e.g. Pixelbar's spacenet membership) — not a
  // feature flag with a safe universal default, so there's no default here.
  spacefed: z
    .object({
      spacenet: z.boolean().default(false),
      spacesaml: z.boolean().default(false),
      spacephone: z.boolean().default(false),
    })
    .default({ spacenet: false, spacesaml: false, spacephone: false }),
});

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

export const spaceConfigSchema = z.object({
  space: spaceMetadataSchema,
  apiKeys: z.array(apiKeyEntrySchema).default([]),
  legacyDevices: z.array(legacyDeviceSchema).default([]),
});

export type SpaceConfig = z.infer<typeof spaceConfigSchema>;
export type Keymaster = z.infer<typeof keymasterSchema>;
export type ApiKeyEntry = z.infer<typeof apiKeyEntrySchema>;
export type LegacyDevice = z.infer<typeof legacyDeviceSchema>;
