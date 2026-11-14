import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";
import { spaceApiConfigSchema } from "../../src/config/schema.js";
import { buildSpaceApiDocument } from "../../src/domain/spaceapi/builder.js";

const config = spaceApiConfigSchema.parse(parseYaml(readFileSync("config/spaceapi.sample.yaml", "utf8")));

const snapshot = (state: "open" | "closed", changedAt = "2026-01-01T12:00:00.000Z") => ({ state, changedAt });

describe("buildSpaceApiDocument", () => {
  it("declares 0.13 with `api` and later versions with `api_compatibility`", () => {
    expect(buildSpaceApiDocument(config, "0.13", snapshot("open")).api).toBe("0.13");
    expect(buildSpaceApiDocument(config, "0.13", snapshot("open"))).not.toHaveProperty("api_compatibility");
    for (const version of ["14", "15"] as const) {
      const document = buildSpaceApiDocument(config, version, snapshot("open"));
      expect(document.api_compatibility).toEqual([version]);
      expect(document).not.toHaveProperty("api");
    }
  });

  it.each(["open", "closed"] as const)("reports %s in state.open, and has no top-level `open`", (state) => {
    for (const version of ["0.13", "14", "15"] as const) {
      const document = buildSpaceApiDocument(config, version, snapshot(state));
      expect(document.state.open).toBe(state === "open");
      expect(document).not.toHaveProperty("open");
    }
  });

  it("reports the last change in unix seconds", () => {
    const document = buildSpaceApiDocument(config, "15", snapshot("open", "2026-01-01T12:00:00.900Z"));
    expect(document.state.lastchange).toBe(Date.UTC(2026, 0, 1, 12) / 1000);
  });

  it("leaves lastchange out while no state has been recorded (the epoch default)", () => {
    const document = buildSpaceApiDocument(config, "15", snapshot("closed", new Date(0).toISOString()));
    expect(document.state).not.toHaveProperty("lastchange");
  });

  it("keeps the configured state fields next to the live ones", () => {
    const document = buildSpaceApiDocument(config, "0.13", snapshot("closed"));
    const logo = "https://www.pixelbar.nl/public/logo.png";
    expect(document.state.icon).toEqual({ open: logo, closed: logo });
  });

  it("does not let one request's live fields leak into the stored config", () => {
    buildSpaceApiDocument(config, "15", snapshot("open"));
    expect(config.documents["15"].state).not.toHaveProperty("open");
  });
});
