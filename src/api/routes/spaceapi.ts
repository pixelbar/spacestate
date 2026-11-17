import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ConfigStore } from "../../config/loader.js";
import type { SpaceApiConfig } from "../../config/schema.js";
import { buildSpaceApiDocument, type SpaceApiDocument } from "../../domain/spaceapi/builder.js";
import { LATEST_SPACEAPI_VERSION, parseSpaceApiVersion, type SpaceApiVersion } from "../../domain/spaceapi/versions.js";
import type { StateService } from "../../domain/state/service.js";
import type { ApiPluginOptions } from "../plugin.js";

/**
 * Serves one version's SpaceAPI document with the headers the SpaceAPI
 * directory asks for.
 */
async function serveSpaceApi(
  reply: FastifyReply,
  version: SpaceApiVersion,
  { stateService, spaceApiStore }: { stateService: StateService; spaceApiStore: ConfigStore<SpaceApiConfig> },
): Promise<SpaceApiDocument> {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Cache-Control", "no-cache");
  const snapshot = await stateService.getCurrentState();
  return buildSpaceApiDocument(spaceApiStore.get(), version, snapshot);
}

export const spaceApiRoutes: FastifyPluginAsync<ApiPluginOptions> = async (fastify, opts) => {
  // The default addresses serve the latest version. `/` (on spaceapi.pixelbar.nl)
  // is the one the SpaceAPI directory lists, so it lives here and not in the
  // legacy shim, which is meant to be deleted.
  for (const path of ["/", "/api/v1/spaceapi"]) {
    fastify.get(path, async (_request, reply) => serveSpaceApi(reply, LATEST_SPACEAPI_VERSION, opts));
  }

  fastify.get<{ Params: { version: string } }>("/api/v1/spaceapi/:version", async (request, reply) => {
    const version = parseSpaceApiVersion(request.params.version);
    if (!version) return reply.callNotFound();
    return serveSpaceApi(reply, version, opts);
  });

  // Short addresses on the root of spaceapi.pixelbar.nl, e.g. /spaceapi/15.json.
  fastify.get<{ Params: { file: string } }>("/spaceapi/:file", async (request, reply) => {
    const match = /^(.+)\.json$/.exec(request.params.file);
    const version = match ? parseSpaceApiVersion(match[1]!) : undefined;
    if (!version) return reply.callNotFound();
    return serveSpaceApi(reply, version, opts);
  });
};
