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
