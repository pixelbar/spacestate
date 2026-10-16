import type { FastifyPluginAsync } from "fastify";
import { buildSpaceApiDocument } from "../../domain/spaceapi/builder.js";
import type { ApiPluginOptions } from "../plugin.js";

export const spaceApiRoutes: FastifyPluginAsync<ApiPluginOptions> = async (
  fastify,
  { stateService, configStore },
) => {
  fastify.get("/api/v1/spaceapi", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cache-Control", "no-cache");
    const snapshot = await stateService.getCurrentState();
    return buildSpaceApiDocument(configStore.get(), snapshot);
  });
};
