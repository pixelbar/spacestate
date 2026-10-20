import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hasRole, resolveApiKey, type AuthorizedKey } from "../../auth/apiKey.js";
import type { WebhookEntry } from "../../config/schema.js";
import { validateWebhookUrl } from "../../domain/webhooks/targetPolicy.js";
import type { ApiPluginOptions } from "../plugin.js";

const registerBodySchema = z.object({
  url: z.string().min(1).max(2048),
  description: z.string().max(200).optional(),
});

/** Everything but the signing secret, which is shown once at registration. */
function publicView(webhook: WebhookEntry) {
  const { secret: _secret, ...rest } = webhook;
  return rest;
}

export const webhookRoutes: FastifyPluginAsync<ApiPluginOptions> = async (
  fastify,
  { apiKeyStore, webhookRegistry, webhookPolicy },
) => {
  // Managing webhooks needs a write key: a registration makes the service
  // send requests to an arbitrary URL, so it is not open to read keys. A key
  // sees and manages only its own registrations (URLs can embed secrets);
  // someone else's id answers 404, same as one that never existed.
  function requireWriter(request: FastifyRequest, reply: FastifyReply): AuthorizedKey | undefined {
    const key = resolveApiKey(apiKeyStore.get(), request);
    if (key && hasRole(key, "write")) return key;
    request.log.warn({ keyId: key?.id }, "webhook management rejected: unauthorized");
    void reply.code(401).send({ error: "unauthorized" });
    return undefined;
  }

  fastify.get("/api/v1/webhooks", async (request, reply) => {
    const key = requireWriter(request, reply);
    if (!key) return reply;
    return { webhooks: webhookRegistry.listOwnedBy(key.id).map(publicView) };
  });

  fastify.post("/api/v1/webhooks", async (request, reply) => {
    const key = requireWriter(request, reply);
    if (!key) return reply;

    const parsed = registerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
    }
    const { url, description } = parsed.data;

    const problem = validateWebhookUrl(url, webhookPolicy);
    if (problem) {
      return reply.code(400).send({ error: "invalid_url", message: `url ${problem}` });
    }

    const result = await webhookRegistry.register({ url, description, createdBy: key.id });
    if (result.kind === "duplicate") {
      return reply.code(409).send({ error: "already_registered", id: result.existing.id });
    }
    if (result.kind === "limit") {
      return reply.code(409).send({ error: "too_many_webhooks" });
    }

    request.log.info({ webhook: result.webhook.id, keyId: key.id }, "webhook registered");
    return reply.code(201).send({ ...publicView(result.webhook), secret: result.webhook.secret });
  });

  fastify.delete<{ Params: { id: string } }>("/api/v1/webhooks/:id", async (request, reply) => {
    const key = requireWriter(request, reply);
    if (!key) return reply;

    const removed = await webhookRegistry.remove(request.params.id, key.id);
    if (!removed) return reply.code(404).send({ error: "not_found" });

    request.log.info({ webhook: request.params.id, keyId: key.id }, "webhook removed");
    return reply.code(204).send();
  });
};
