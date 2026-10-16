import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hasRole, resolveApiKey } from "../../auth/apiKey.js";
import type { ApiPluginOptions } from "../plugin.js";

const historyQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  device: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  continuationToken: z.string().optional(),
});

export const historyRoutes: FastifyPluginAsync<ApiPluginOptions> = async (
  fastify,
  { historyService, configStore },
) => {
  fastify.get("/api/v1/history", async (request, reply) => {
    const key = resolveApiKey(configStore.get(), request);
    if (!hasRole(key, "read")) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.issues });
    }

    return historyService.query(parsed.data);
  });
};
