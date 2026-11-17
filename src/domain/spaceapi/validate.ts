import { Ajv, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import { isPlainObject, type JsonObject } from "./render.js";
import { SPACEAPI_SCHEMAS, type SpaceApiVersion } from "./versions.js";

// ajv-formats is CommonJS: under NodeNext the default import is
// `module.exports`, and the plugin is its `default` property.
const addFormats = addFormatsModule.default;

/**
 * - `official`: the schema exactly as published. It accepts any key it does
 *   not define, so a field from the wrong version passes.
 * - `strict`: the same schema, but every object it describes rejects keys it
 *   does not define, except `ext_*` (which the spec reserves for custom
 *   fields). This is what catches `issue_report_channels` tagged for v15.
 */
export type SchemaMode = "official" | "strict";

const validators = new Map<string, ValidateFunction>();

function validator(version: SpaceApiVersion, mode: SchemaMode): ValidateFunction {
  const key = `${version}:${mode}`;
  let validate = validators.get(key);
  if (!validate) {
    // One Ajv per schema: the strict copy keeps the official one's $id.
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const schema = SPACEAPI_SCHEMAS[version];
    validate = ajv.compile(mode === "strict" ? strictCopy(schema) : schema);
    validators.set(key, validate);
  }
  return validate;
}

/** Problems with `document` as a `version` document; empty when it is valid. */
export function validateSpaceApiDocument(
  version: SpaceApiVersion,
  document: unknown,
  mode: SchemaMode = "strict",
): string[] {
  const validate = validator(version, mode);
  if (validate(document)) return [];
  return (validate.errors ?? []).map((error) => {
    const at = error.instancePath ? error.instancePath.slice(1).replaceAll("/", ".") : "(document)";
    if (error.keyword === "additionalProperties") {
      const extra = (error.params as { additionalProperty: string }).additionalProperty;
      const path = error.instancePath ? `${at}.${extra}` : extra;
      return `${path} is not part of SpaceAPI ${version} (tag it for the versions that have it, or prefix it ext_)`;
    }
    return `${at} ${error.message ?? "is invalid"}`;
  });
}

function strictCopy(schema: object): object {
  const copy = structuredClone(schema) as JsonObject;
  closeObjects(copy);
  return copy;
}

function closeObjects(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(closeObjects);
    return;
  }
  if (!isPlainObject(node)) return;
  if (isPlainObject(node.properties) && node.additionalProperties === undefined) {
    node.additionalProperties = false;
    node.patternProperties = { "^ext_": {}, ...(isPlainObject(node.patternProperties) ? node.patternProperties : {}) };
  }
  for (const value of Object.values(node)) closeObjects(value);
}
