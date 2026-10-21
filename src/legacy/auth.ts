import * as Sentry from "@sentry/node";
import { findLegacyDevice } from "../auth/legacyToken.js";
import type { LegacyConfig, LegacyDevice } from "../config/schema.js";

export interface LegacyAuthResult {
  device: LegacyDevice;
}

/**
 * Thin wrapper over auth/legacyToken.ts — isolated here so nothing else in
 * legacy/ touches auth internals directly. The token is the only credential:
 * a valid one is accepted from any address, and no request header (notably
 * X-Forwarded-For) takes part in the decision.
 */
export function authenticateLegacyRequest(config: LegacyConfig, token: string): LegacyAuthResult | undefined {
  const device = findLegacyDevice(config, token);
  if (!device) {
    Sentry.logger.warn("legacy.auth failed: no device matches the token");
    return undefined;
  }
  Sentry.logger.debug("legacy.auth succeeded", { device: device.shortname });
  return { device };
}
