import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "legacy");

export interface LegacyEndpointRecording {
  url: string;
  method: string;
  status?: number;
  headers?: Record<string, string>;
  bodies?: Record<string, string>;
  outcomes?: Record<string, { status: number; body: string; headers?: Record<string, string> }>;
}

export interface LegacyRecording {
  recordedAt: string;
  endpoints: {
    spaceapi: LegacyEndpointRecording;
    spacestate: LegacyEndpointRecording;
    togglestate: LegacyEndpointRecording;
  };
}

export const legacyRecording = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "recording.json"), "utf8"),
) as LegacyRecording;

/**
 * The recorded body exactly as the legacy server sent it — no trailing
 * newline, PHP's `\/` escaping intact. Read as a string, not parsed, so
 * byte-level comparisons are possible.
 */
export function legacyBody(endpoint: "spaceapi" | "spacestate", state: "open" | "closed"): string {
  const bodies = legacyRecording.endpoints[endpoint].bodies;
  if (!bodies?.[state]) throw new Error(`No ${state} body recorded for ${endpoint}`);
  return readFileSync(join(FIXTURE_DIR, bodies[state]), "utf8");
}
