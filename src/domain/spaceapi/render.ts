import { SPACEAPI_VERSIONS, type SpaceApiVersion } from "./versions.js";

export type JsonObject = { [key: string]: unknown };

/** One `versioned:` entry: a partial document and the versions it belongs to. */
export type SpaceApiFragment = { versions: SpaceApiVersion[] } & JsonObject;

/** `spaceapi.yaml`, after its shape has been checked. */
export interface SpaceApiConfigFile {
  shared: JsonObject;
  versioned: SpaceApiFragment[];
}

/**
 * Fields the service fills in on every request. Config that sets one is
 * rejected rather than silently overwritten, so nobody edits a value that
 * never reaches the output.
 */
export const GENERATED_PATHS = ["api", "api_compatibility", "open", "state.open", "state.lastchange"] as const;

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Renders the static part of each version's document: `shared`, with every
 * fragment tagged for that version deep-merged into it, in file order.
 *
 * Objects merge key by key; anything else (strings, numbers, arrays) is a
 * value. Setting a value that another block already set for the same version
 * is a problem, not an override: `shared` is the part every version has in
 * common, and a key has exactly one home per version.
 */
export function renderStaticDocuments(file: SpaceApiConfigFile): {
  documents: Record<SpaceApiVersion, JsonObject>;
  problems: string[];
} {
  const problems: string[] = [];
  for (const path of GENERATED_PATHS) {
    if (hasPath(file.shared, path)) problems.push(`shared.${path} is filled in by the service; remove it`);
    file.versioned.forEach((fragment, i) => {
      if (hasPath(fragment, path)) problems.push(`versioned[${i}].${path} is filled in by the service; remove it`);
    });
  }

  const documents = {} as Record<SpaceApiVersion, JsonObject>;
  for (const version of SPACEAPI_VERSIONS) {
    const document: JsonObject = {};
    const origins = new Map<string, string>();
    merge(document, file.shared, "", "shared", origins, version, problems);
    file.versioned.forEach((fragment, i) => {
      if (!fragment.versions.includes(version)) return;
      const { versions: _versions, ...content } = fragment;
      merge(document, content, "", `versioned[${i}]`, origins, version, problems);
    });
    documents[version] = document;
  }
  return { documents, problems };
}

function merge(
  target: JsonObject,
  source: JsonObject,
  prefix: string,
  origin: string,
  origins: Map<string, string>,
  version: SpaceApiVersion,
  problems: string[],
): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const existing = target[key];
    if (existing === undefined) {
      target[key] = isPlainObject(value) ? structuredClone(value) : value;
      markOrigin(value, path, origin, origins);
    } else if (isPlainObject(existing) && isPlainObject(value)) {
      merge(existing, value, path, origin, origins, version, problems);
    } else {
      const first = origins.get(path) ?? originOfAncestor(path, origins) ?? "another block";
      problems.push(`${path} is set by both ${first} and ${origin} for ${version}; give it one home`);
    }
  }
}

function markOrigin(value: unknown, path: string, origin: string, origins: Map<string, string>): void {
  origins.set(path, origin);
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) markOrigin(child, `${path}.${key}`, origin, origins);
  }
}

function originOfAncestor(path: string, origins: Map<string, string>): string | undefined {
  const parts = path.split(".");
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const origin = origins.get(parts.slice(0, i).join("."));
    if (origin) return origin;
  }
  return undefined;
}

function hasPath(object: JsonObject, path: string): boolean {
  let node: unknown = object;
  for (const part of path.split(".")) {
    if (!isPlainObject(node) || !Object.hasOwn(node, part)) return false;
    node = node[part];
  }
  return true;
}
