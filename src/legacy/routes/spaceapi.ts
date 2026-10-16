import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { buildSpaceApiDocument } from "../../domain/spaceapi/builder.js";
import type { LegacyPluginOptions } from "../plugin.js";

/**
 * Served at both /index.php and the bare root: Apache's directory-index
 * behavior made "/" the de facto public address for the old SpaceAPI
 * document, so any existing directory listing/dashboard likely points at
 * the domain root rather than /index.php explicitly.
 */
export const legacySpaceApiRoute: FastifyPluginAsync<LegacyPluginOptions> = async (
  fastify,
  { stateService, configStore },
) => {
  const handler = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cache-Control", "no-cache");
    const snapshot = await stateService.getCurrentState();
    return buildSpaceApiDocument(configStore.get(), snapshot);
  };

  fastify.get("/index.php", handler);
  fastify.get("/", handler);
};
