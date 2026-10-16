import type { FastifyPluginAsync } from "fastify";

/**
 * Process-only — no storage call. Used as the Container Apps probe so a
 * transient Table Storage hiccup doesn't flap a replica that's waking up
 * from scale-to-zero.
 */
export const healthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/healthz", async () => ({ status: "ok" }));
};
