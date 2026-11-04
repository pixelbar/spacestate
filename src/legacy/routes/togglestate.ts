import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { resolveClientIp } from "../../auth/legacyToken.js";
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
 * Every outcome is logged once, under the `legacy.togglestate` prefix with
 * structured attributes (never the token); request.log reaches Sentry Logs
 * through pinoIntegration. Unexpected failures are left to the shared error
 * handler, which logs and captures them (once — Sentry dedupes the same error
 * object, so capturing in several layers would drop the outer route context)
 * and shapes the response.
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
    const base = { route: request.routeOptions?.url ?? request.url, method: request.method };

    const parsedQuery = toggleQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      request.log.warn(
        { ...base, issues: parsedQuery.error.issues.map((issue) => issue.path.join(".")).join(",") },
        "legacy.togglestate rejected: invalid params",
      );
      return reply.redirect(LEGACY_REDIRECT_URL);
    }

    const { token, user, state } = parsedQuery.data;
    const auth = authenticateLegacyRequest(legacyStore.get(), request, token);
    if (!auth) {
      request.log.warn(
        { ...base, user, state, ip: request.ip, client_ip: resolveClientIp(request) },
        "legacy.togglestate rejected: unknown token or IP",
      );
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
      { ...base, state, user, device: auth.device.shortname, changed: result.changed },
      result.changed ? "legacy.togglestate success: state changed" : "legacy.togglestate success: already in state",
    );

    reply.type("text/plain");
    return result.changed ? LEGACY_SUCCESS : LEGACY_ALREADY_TOGGLED;
  };

  for (const path of ["/togglestate.php", "/togglebaker.php"]) {
    fastify.get(path, handler);
    fastify.post(path, handler);
  }
};
