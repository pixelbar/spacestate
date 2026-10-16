import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spaceApiConfigSchema } from "../../src/config/schema.js";
import { buildSpaceApiDocument } from "../../src/domain/spaceapi/builder.js";

const rawConfig = JSON.parse(readFileSync("config/spaceapi.sample.json", "utf8"));
const config = spaceApiConfigSchema.parse(rawConfig);

const snapshot = (state: "open" | "closed") => ({
  state,
  changedAt: "2026-01-01T12:00:00.000Z",
  changedBy: "alice",
  method: "api",
  source: "api" as const,
});

describe("buildSpaceApiDocument", () => {
  it("reports open in both `open` and `state.open`", () => {
    const doc = buildSpaceApiDocument(config, snapshot("open"));
    expect(doc.open).toBe(true);
    expect(doc.state.open).toBe(true);
  });

  it("reports closed", () => {
    const doc = buildSpaceApiDocument(config, snapshot("closed"));
    expect(doc.open).toBe(false);
    expect(doc.state.open).toBe(false);
  });

  it("serves the static config verbatim, adding only the open flags", () => {
    const doc = buildSpaceApiDocument(config, snapshot("closed"));
    expect(doc).toEqual({
      ...rawConfig,
      open: false,
      state: { ...rawConfig.state, open: false },
    });
  });
});

describe("SpaceAPI 0.13 schema compliance", () => {
  const schema = JSON.parse(readFileSync("test/fixtures/spaceapi-13.schema.json", "utf8"));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  it.each(["open", "closed"] as const)("builds a valid document when %s", (state) => {
    const doc = buildSpaceApiDocument(config, snapshot(state));
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects an invalid document (sanity check on the validator)", () => {
    expect(validate({ ...buildSpaceApiDocument(config, snapshot("open")), api: "0.12" })).toBe(false);
  });
});
