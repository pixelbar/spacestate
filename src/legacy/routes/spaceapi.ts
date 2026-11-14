import type { FastifyPluginAsync } from "fastify";
import { buildSpaceApiDocument } from "../../domain/spaceapi/builder.js";
import { LATEST_SPACEAPI_VERSION } from "../../domain/spaceapi/versions.js";
import type { LegacyPluginOptions } from "../plugin.js";

/**
 * The old SpaceApiScripts address. It serves what `/` serves (the latest
 * version), which is in the API routes: `/` is the address the SpaceAPI
 * directory lists, so it must outlive this shim.
 */
export const legacySpaceApiRoute: FastifyPluginAsync<LegacyPluginOptions> = async (
  fastify,
  { stateService, spaceApiStore },
) => {
  fastify.get("/index.php", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cache-Control", "no-cache");
    const snapshot = await stateService.getCurrentState();
    return buildSpaceApiDocument(spaceApiStore.get(), LATEST_SPACEAPI_VERSION, snapshot);
  });
};
