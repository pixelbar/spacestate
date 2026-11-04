import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DeliveryError } from "../types.js";

export interface TargetPolicy {
  /** Permit plain http:// targets. Local development only. */
  allowInsecure: boolean;
  /** Permit loopback/private/link-local targets. Local development and tests only. */
  allowPrivate: boolean;
}

export const STRICT_POLICY: TargetPolicy = { allowInsecure: false, allowPrivate: false };

export function policyFromEnv(env: NodeJS.ProcessEnv): TargetPolicy {
  return {
    allowInsecure: env.WEBHOOK_ALLOW_INSECURE === "true",
    allowPrivate: env.WEBHOOK_ALLOW_PRIVATE_TARGETS === "true",
  };
}

function isPrivateIPv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number) as [number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. the cloud metadata service
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;

  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): judge the embedded IPv4 address.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return isPrivateIPv4(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  const firstHextet = parseInt(lower.split(":")[0] || "0", 16);
  return (
    (firstHextet & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (firstHextet & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (firstHextet & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return false;
}

/**
 * Cheap, synchronous checks on a webhook URL: scheme, credentials, and
 * hostnames that are obviously internal. Returns a reason when rejected.
 */
export function validateWebhookUrl(raw: string, policy: TargetPolicy): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:" && !(policy.allowInsecure && url.protocol === "http:")) {
    return "must be an https:// URL";
  }
  if (url.username || url.password) return "must not contain credentials";

  if (!policy.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      return "must not point at an internal host";
    }
    if (isPrivateAddress(host)) return "must not point at a private IP address";
  }
  return undefined;
}

/**
 * Resolves the hostname and refuses to deliver if it points at a private
 * address. Run at delivery time, not only at registration, because DNS can
 * change after a webhook was accepted. It cannot close the gap between this
 * lookup and the connection `fetch` then makes (DNS rebinding); the https-only
 * rule and the response never being read back keep that gap low-impact.
 */
export async function assertPublicTarget(rawUrl: string, policy: TargetPolicy): Promise<void> {
  if (policy.allowPrivate) return;
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return; // already judged by validateWebhookUrl
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    // Final: DNS that points inside now will not point outside in 30 seconds.
    throw new DeliveryError("target resolves to a private address", { retryable: false });
  }
}
