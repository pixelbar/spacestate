import type { FastifyRequest } from "fastify";
import type { LegacyConfig, LegacyDevice } from "../config/schema.js";
import { constantTimeEquals } from "./timingSafeCompare.js";

/**
 * Mirrors the legacy PHP's IP resolution: honor X-Forwarded-For only when
 * present and different from the raw remote address. Fastify's `request.ip`
 * is the raw socket address here because `trustProxy` is deliberately left
 * off — this is the one place that needs the legacy quirk, not a
 * server-wide default.
 */
export function resolveClientIp(request: FastifyRequest): string {
  const forwardedHeader = request.headers["x-forwarded-for"];
  const forwarded = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
  const forwardedIp = forwarded?.split(",")[0]?.trim();
  if (forwardedIp && forwardedIp !== request.ip) {
    return forwardedIp;
  }
  return request.ip;
}

export function findLegacyDevice(
  config: LegacyConfig,
  token: string,
  ip: string,
): LegacyDevice | undefined {
  return config.legacyDevices.find(
    (device) => constantTimeEquals(device.token, token) && device.ip === ip,
  );
}
