import type { LegacyConfig, LegacyDevice } from "../config/schema.js";
import { constantTimeEquals } from "./timingSafeCompare.js";

/**
 * Looks a legacy device up by its token alone. There is deliberately no IP
 * check: the per-device IP allowlist — and the X-Forwarded-For resolution that
 * fed it — was dropped, so auth on these routes is by credential only, like
 * `POST /api/v1/state`. An `ip` left in a deployed config blob is ignored
 * (see config/schema.ts).
 */
export function findLegacyDevice(config: LegacyConfig, token: string): LegacyDevice | undefined {
  return config.legacyDevices.find((device) => constantTimeEquals(device.token, token));
}
