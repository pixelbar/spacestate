import * as Sentry from "@sentry/node";
import type { FastifyRequest } from "fastify";
import { findLegacyDevice, resolveClientIp } from "../auth/legacyToken.js";
import type { LegacyConfig, LegacyDevice } from "../config/schema.js";

export interface LegacyAuthResult {
  device: LegacyDevice;
}

/** Thin wrapper over auth/legacyToken.ts — isolated here so nothing else in legacy/ touches auth internals directly. */
export function authenticateLegacyRequest(
  config: LegacyConfig,
  request: FastifyRequest,
  token: string,
): LegacyAuthResult | undefined {
  const ip = resolveClientIp(request);
  const device = findLegacyDevice(config, token, ip);
  if (!device) {
    Sentry.logger.warn("legacy.auth failed: no device matches token and IP", { ip });
    return undefined;
  }
  Sentry.logger.debug("legacy.auth succeeded", { device: device.shortname, ip });
  return { device };
}
