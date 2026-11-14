import { z } from "zod";
import { buildSpaceApiDocument, type SpaceApiConfig } from "../domain/spaceapi/builder.js";
import { renderStaticDocuments } from "../domain/spaceapi/render.js";
import { validateSpaceApiDocument } from "../domain/spaceapi/validate.js";
import { SPACEAPI_VERSIONS } from "../domain/spaceapi/versions.js";

export type { SpaceApiConfig } from "../domain/spaceapi/builder.js";

/**
 * `spaceapi.yaml`: the public SpaceAPI document for every version served
 * (see src/domain/spaceapi/versions.ts). `shared` is what every version has in
 * common; each `versioned` fragment adds what only the listed versions have,
 * deep-merged into `shared`. Parsing renders each version and validates it
 * against that version's official schema in strict mode, so a key in the
 * wrong version, or a missing required one, fails here and not in prod.
 * The live fields (`api`/`api_compatibility`, `state.open`,
 * `state.lastchange`) are the service's and may not be set.
 */
export const spaceApiConfigSchema = z
  .object({
    shared: z.record(z.string(), z.unknown()),
    versioned: z
      .array(
        z
          .object({
            versions: z
              .array(z.enum(SPACEAPI_VERSIONS, { error: `versions must be among ${SPACEAPI_VERSIONS.join(", ")} (quote them: "14")` }))
              .min(1),
          })
          .catchall(z.unknown()),
      )
      .default([]),
  })
  .strict()
  .transform((file, ctx): SpaceApiConfig => {
    const { documents, problems } = renderStaticDocuments(file);
    for (const version of SPACEAPI_VERSIONS) {
      // Placeholder live fields, so required ones (0.13's `state.open`) are present.
      const sample = buildSpaceApiDocument({ space: "", documents }, version, {
        state: "closed",
        changedAt: "2000-01-01T00:00:00Z",
      });
      for (const problem of validateSpaceApiDocument(version, sample)) problems.push(`SpaceAPI ${version}: ${problem}`);
    }
    for (const message of problems) ctx.addIssue({ code: "custom", message });
    const space = file.shared.space;
    if (typeof space !== "string") {
      ctx.addIssue({ code: "custom", message: "shared.space must be the space's name", path: ["shared", "space"] });
    }
    return { space: typeof space === "string" ? space : "", documents };
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

export type ApiKeysConfig = z.infer<typeof apiKeysConfigSchema>;
export type LegacyConfig = z.infer<typeof legacyConfigSchema>;
export type ApiKeyEntry = z.infer<typeof apiKeyEntrySchema>;
export type LegacyDevice = z.infer<typeof legacyDeviceSchema>;
export type WebhooksConfig = z.infer<typeof webhooksConfigSchema>;
export type WebhookEntry = z.infer<typeof webhookEntrySchema>;
