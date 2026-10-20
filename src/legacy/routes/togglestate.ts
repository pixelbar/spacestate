import * as Sentry from "@sentry/node";
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
 * not behavior worth preserving. Both now share one handler, for GET and POST
 * (params always come from the query string, as in the PHP).
 *
 * The `token` is the whole credential. The legacy per-device IP allowlist, and
 * the X-Forwarded-For quirk that fed it, are gone — a valid token works from
 * anywhere. Carrying that token in the URL is why these routes stay deprecated
 * in favour of `POST /api/v1/state`.
 *
 * Every outcome is logged to Sentry Logs under the `legacy.togglestate`
 * prefix with structured attributes (never the token). Unexpected failures
 * are logged and rethrown; the shared error handler captures the exception
 * (once — Sentry dedupes the same error object, so capturing in several
 * layers would drop the outer route context) and shapes the response.
 */
export const togglestateRoutes: FastifyPluginAsync<LegacyPluginOptions> = async (
  fastify,
  { stateService, legacyStore },
) => {
  // The legacy PHP read `$_GET` only, whatever the HTTP method: a POST is
  // handled identically to a GET and its body is never looked at. Mirror that
  // by discarding bodies of any content type (without this Fastify would 415
  // unknown types and 400 on malformed JSON).
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser("*", (_request, _payload, done) => {
    done(null, undefined);
  });

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions?.url ?? request.url;
    const base = { route, method: request.method };

    try {
      const parsedQuery = toggleQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        request.log.warn("legacy state change rejected: invalid query");
        Sentry.logger.warn("legacy.togglestate rejected: invalid params", {
          ...base,
          issues: parsedQuery.error.issues.map((issue) => issue.path.join(".")).join(","),
        });
        return reply.redirect(LEGACY_REDIRECT_URL);
      }

      const { token, user, state } = parsedQuery.data;
      const auth = authenticateLegacyRequest(legacyStore.get(), token);
      if (!auth) {
        request.log.warn({ user, state }, "legacy state change rejected: unknown token");
        Sentry.logger.warn("legacy.togglestate rejected: unknown token", {
          ...base,
          user,
          state,
          ip: request.ip,
        });
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
      Sentry.logger.info(
        result.changed ? "legacy.togglestate success: state changed" : "legacy.togglestate success: already in state",
        { ...base, state, user, device: auth.device.shortname, changed: result.changed },
      );

      reply.type("text/plain");
      return result.changed ? LEGACY_SUCCESS : LEGACY_ALREADY_TOGGLED;
    } catch (err) {
      Sentry.logger.error("legacy.togglestate failed", {
        ...base,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  for (const path of ["/togglestate.php", "/togglebaker.php"]) {
    fastify.get(path, handler);
    fastify.post(path, handler);
  }
};
