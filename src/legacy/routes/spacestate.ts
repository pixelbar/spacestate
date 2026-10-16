import type { FastifyPluginAsync } from "fastify";
import type { LegacyPluginOptions } from "../plugin.js";
import { legacySpaceStateBody } from "../responses.js";

export const spacestateRoute: FastifyPluginAsync<LegacyPluginOptions> = async (
  fastify,
  { stateService },
) => {
  fastify.get("/spacestate.php", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cache-Control", "no-cache");
    const snapshot = await stateService.getCurrentState();
    return legacySpaceStateBody(snapshot.state);
  });
};
