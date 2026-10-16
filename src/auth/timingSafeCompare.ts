import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison, for comparing secrets (API keys, tokens). */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
