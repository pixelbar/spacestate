/** Shared helpers for the legacy parity contract tests. See README.md. */

/**
 * `json_encode()` without `JSON_UNESCAPED_SLASHES` escapes every `/` as
 * `\/`. Both forms decode to the same string, so this is purely a byte-level
 * difference — undo it to compare bytes with a JavaScript-encoded document.
 */
export function unescapeSlashes(phpJson: string): string {
  return phpJson.replaceAll("\\/", "/");
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key] as Json)]),
    );
  }
  return value;
}

/**
 * Re-serialises a JSON document with its object keys sorted, so two
 * documents that differ only in key order produce identical bytes. Number
 * and string encoding survive, so a difference in how a float or a non-ASCII
 * character is written still shows up.
 */
export function canonicalJson(raw: string): string {
  return JSON.stringify(sortKeys(JSON.parse(raw) as Json));
}

/** The media type without its parameters: `application/json; charset=utf-8` -> `application/json`. */
export function mediaType(contentType: string | string[] | undefined): string {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Matches config/legacy.sample.yaml's "Pixelbar Rotterdam" device. */
export const DEVICE = { token: "dev-legacy-token-manual", ip: "203.0.113.10" };
