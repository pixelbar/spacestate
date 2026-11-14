import schema13 from "./schemas/13.json" with { type: "json" };
import schema14 from "./schemas/14.json" with { type: "json" };
import schema15 from "./schemas/15.json" with { type: "json" };

/**
 * The SpaceAPI versions this service serves, oldest first. The last one is
 * "latest": what `/`, `/index.php` and `/api/v1/spaceapi` serve.
 *
 * Adding a version: copy its schema from https://github.com/SpaceApi/schema
 * into ./schemas/, add it here and to SCHEMAS, then tag the config fragments
 * that apply to it.
 */
export const SPACEAPI_VERSIONS = ["0.13", "14", "15"] as const;
export type SpaceApiVersion = (typeof SPACEAPI_VERSIONS)[number];

export const LATEST_SPACEAPI_VERSION: SpaceApiVersion = SPACEAPI_VERSIONS[SPACEAPI_VERSIONS.length - 1]!;

/**
 * The official JSON schemas, verbatim from SpaceApi/schema at
 * f62c6cfd94d78aa5a9d364ce89e87b4c2d240fbe (2025-08-07).
 */
export const SPACEAPI_SCHEMAS: Record<SpaceApiVersion, object> = {
  "0.13": schema13,
  "14": schema14,
  "15": schema15,
};

export function isSpaceApiVersion(value: string): value is SpaceApiVersion {
  return (SPACEAPI_VERSIONS as readonly string[]).includes(value);
}

/**
 * Maps a version as written in a URL to the version it names. Pre-14
 * versions were `0.x`, so `/13` and `/0.13` both mean 0.13.
 */
export function parseSpaceApiVersion(value: string): SpaceApiVersion | undefined {
  if (isSpaceApiVersion(value)) return value;
  const legacy = `0.${value}`;
  return isSpaceApiVersion(legacy) ? legacy : undefined;
}

/** The version as it appears in URLs: `13`, `14`, `15`. */
export function spaceApiVersionSlug(version: SpaceApiVersion): string {
  return version.replace(/^0\./, "");
}
