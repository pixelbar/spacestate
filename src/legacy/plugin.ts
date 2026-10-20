import type { FastifyPluginAsync } from "fastify";
import type { ConfigStore } from "../config/loader.js";
import type { LegacyConfig, SpaceApiConfig } from "../config/schema.js";
import type { StateService } from "../domain/state/service.js";
import { addCallerMetrics } from "./callerMetrics.js";
import { legacySpaceApiRoute } from "./routes/spaceapi.js";
import { spacestateRoute } from "./routes/spacestate.js";
import { togglestateRoutes } from "./routes/togglestate.js";

export interface LegacyPluginOptions {
  spaceApiStore: ConfigStore<SpaceApiConfig>;
  legacyStore: ConfigStore<LegacyConfig>;
  stateService: StateService;
}

/**
 * Isolated, temporary compatibility shim for hardware/consumers that can't
 * be migrated yet (see the plan). Depends only on domain/config/auth — never
 * the other way around — so removing this whole module is: delete this
 * directory and the one `register()` call for it in app.ts.
 */
export const legacyPlugin: FastifyPluginAsync<LegacyPluginOptions> = async (fastify, opts) => {
  addCallerMetrics(fastify);
  await fastify.register(spacestateRoute, opts);
  await fastify.register(legacySpaceApiRoute, opts);
  await fastify.register(togglestateRoutes, opts);
};
