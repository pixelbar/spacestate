import type { FastifyPluginAsync } from "fastify";
import type { ConfigStore } from "../config/loader.js";
import type { ApiKeysConfig, SpaceApiConfig } from "../config/schema.js";
import type { HistoryService } from "../domain/history/service.js";
import type { StateService } from "../domain/state/service.js";
import { historyRoutes } from "./routes/history.js";
import { spaceApiRoutes } from "./routes/spaceapi.js";
import { stateRoutes } from "./routes/state.js";

export interface ApiPluginOptions {
  spaceApiStore: ConfigStore<SpaceApiConfig>;
  apiKeyStore: ConfigStore<ApiKeysConfig>;
  stateService: StateService;
  historyService: HistoryService;
}

/** The new, clean API — zero knowledge of legacy request/response shapes. */
export const apiPlugin: FastifyPluginAsync<ApiPluginOptions> = async (fastify, opts) => {
  await fastify.register(stateRoutes, opts);
  await fastify.register(historyRoutes, opts);
  await fastify.register(spaceApiRoutes, opts);
};
