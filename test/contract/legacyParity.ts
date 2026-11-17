/** Shared helpers for the legacy parity contract tests. See README.md. */

/** The media type without its parameters: `application/json; charset=utf-8` -> `application/json`. */
export function mediaType(contentType: string | string[] | undefined): string {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Matches config/legacy.sample.yaml's "Pixelbar Rotterdam" device. */
export const DEVICE = { token: "dev-legacy-token-manual", ip: "203.0.113.10" };
