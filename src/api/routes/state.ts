import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hasRole, resolveApiKey } from "../../auth/apiKey.js";
import type { ApiPluginOptions } from "../plugin.js";

const stateChangeBodySchema = z.object({
  state: z.enum(["open", "closed"]),
  user: z.string().min(1),
  method: z.string().min(1),
});

export const stateRoutes: FastifyPluginAsync<ApiPluginOptions> = async (
  fastify,
  { stateService, apiKeyStore },
) => {
  fastify.get("/api/v1/state", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cache-Control", "no-cache");
    const snapshot = await stateService.getCurrentState();
    return { state: snapshot.state, since: snapshot.changedAt };
  });

  fastify.post("/api/v1/state", async (request, reply) => {
    const key = resolveApiKey(apiKeyStore.get(), request);
    if (!hasRole(key, "write")) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = stateChangeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
    }

    const result = await stateService.changeState({ ...parsed.data, source: "api" });

    if (!result.changed) {
      return reply.code(409).send({ error: "already_in_state", state: result.snapshot.state });
    }

    return { state: result.snapshot.state, recordedAt: result.snapshot.changedAt };
  });
};
