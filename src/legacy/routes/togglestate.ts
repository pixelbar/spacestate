import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticateLegacyRequest } from "../auth.js";
import type { LegacyPluginOptions } from "../plugin.js";
import { LEGACY_ALREADY_TOGGLED, LEGACY_REDIRECT_URL, LEGACY_SUCCESS } from "../responses.js";

const toggleQuerySchema = z.object({
  token: z.string().min(1),
  user: z.string().min(1),
  state: z.enum(["open", "closed"]),
});

/**
 * Serves both /togglestate.php and /togglebaker.php — in the legacy system
 * these were near-duplicate files (one per physical device) whose only
 * differences were accidental drift (debug flag, X-Forwarded-For handling),
 * not behavior worth preserving. Both now share one handler.
 */
export const togglestateRoutes: FastifyPluginAsync<LegacyPluginOptions> = async (
  fastify,
  { stateService, legacyStore },
) => {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedQuery = toggleQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      request.log.warn("legacy state change rejected: invalid query");
      return reply.redirect(LEGACY_REDIRECT_URL);
    }

    const { token, user, state } = parsedQuery.data;
    const auth = authenticateLegacyRequest(legacyStore.get(), request, token);
    if (!auth) {
      request.log.warn({ user, state }, "legacy state change rejected: unknown token or IP");
      return reply.redirect(LEGACY_REDIRECT_URL);
    }

    const result = await stateService.changeState({
      state,
      user,
      method: auth.device.method,
      source: "legacy",
      deviceShortname: auth.device.shortname,
    });

    request.log.info(
      { state, user, device: auth.device.shortname, changed: result.changed },
      result.changed ? "space state changed (legacy)" : "space state change ignored: already in state (legacy)",
    );

    reply.type("text/plain");
    return result.changed ? LEGACY_SUCCESS : LEGACY_ALREADY_TOGGLED;
  };

  fastify.get("/togglestate.php", handler);
  fastify.get("/togglebaker.php", handler);
};
