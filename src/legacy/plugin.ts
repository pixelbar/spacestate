import type { FastifyPluginAsync } from "fastify";
import type { ConfigStore } from "../config/loader.js";
import type { StateService } from "../domain/state/service.js";
import { legacySpaceApiRoute } from "./routes/spaceapi.js";
import { spacestateRoute } from "./routes/spacestate.js";
import { togglestateRoutes } from "./routes/togglestate.js";

export interface LegacyPluginOptions {
  configStore: ConfigStore;
  stateService: StateService;
}

/**
 * Isolated, temporary compatibility shim for hardware/consumers that can't
 * be migrated yet (see the plan). Depends only on domain/config/auth — never
 * the other way around — so removing this whole module is: delete this
 * directory and the one `register()` call for it in app.ts.
 */
export const legacyPlugin: FastifyPluginAsync<LegacyPluginOptions> = async (fastify, opts) => {
  await fastify.register(spacestateRoute, opts);
  await fastify.register(legacySpaceApiRoute, opts);
  await fastify.register(togglestateRoutes, opts);
};
