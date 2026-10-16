import type { FastifyRequest } from "fastify";
import type { ApiKeysConfig } from "../config/schema.js";
import { constantTimeEquals } from "./timingSafeCompare.js";

export type ApiKeyRole = "read" | "write";

export interface AuthorizedKey {
  id: string;
  role: ApiKeyRole;
}

const BEARER_PREFIX = "Bearer ";

export function resolveApiKey(config: ApiKeysConfig, request: FastifyRequest): AuthorizedKey | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith(BEARER_PREFIX)) return undefined;

  const presented = header.slice(BEARER_PREFIX.length).trim();
  const match = config.apiKeys.find((entry) => constantTimeEquals(entry.key, presented));
  return match ? { id: match.id, role: match.role } : undefined;
}

/** "write" implies "read" in this simple two-role model. */
export function hasRole(key: AuthorizedKey | undefined, role: ApiKeyRole): boolean {
  if (!key) return false;
  if (key.role === "write") return true;
  return key.role === role;
}
