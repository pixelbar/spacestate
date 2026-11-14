import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { describe, expect, it } from "vitest";
import { spaceApiConfigSchema } from "../../src/config/schema.js";
import { validateSpaceApiDocument } from "../../src/domain/spaceapi/validate.js";

const sample = () => parseYaml(readFileSync("config/spaceapi.sample.yaml", "utf8")) as Record<string, any>;

/** The smallest config that renders a valid document for every version. */
const minimal = () => ({
  shared: {
    space: "Testspace",
    logo: "https://example.org/logo.png",
    url: "https://example.org",
    location: { lat: 1, lon: 2 },
    contact: { email: "board@example.org" },
  },
  versioned: [{ versions: ["0.13"], issue_report_channels: ["email"] }],
});

function problems(raw: unknown): string[] {
  const result = spaceApiConfigSchema.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("spaceapi.yaml", () => {
  it("accepts the sample", () => {
    expect(problems(sample())).toEqual([]);
  });

  it("accepts a minimal config", () => {
    expect(problems(minimal())).toEqual([]);
  });

  it("deep-merges fragments into shared, only for the versions they list", () => {
    const raw = minimal();
    raw.versioned.push({ versions: ["15"], location: { country_code: "NL" } } as never);
    const { documents } = spaceApiConfigSchema.parse(raw);

    expect(documents["15"].location).toEqual({ lat: 1, lon: 2, country_code: "NL" });
    expect(documents["14"].location).toEqual({ lat: 1, lon: 2 });
    expect(documents["0.13"].issue_report_channels).toEqual(["email"]);
    expect(documents["14"]).not.toHaveProperty("issue_report_channels");
    expect(documents["15"]).not.toHaveProperty("versions");
  });

  it("does not share objects between versions", () => {
    const { documents } = spaceApiConfigSchema.parse(minimal());
    expect(documents["14"].contact).not.toBe(documents["15"].contact);
  });

  it("rejects a value set in two places for the same version", () => {
    const raw = minimal();
    raw.versioned.push({ versions: ["14", "15"], contact: { email: "other@example.org" } } as never);
    expect(problems(raw)).toEqual([
      "contact.email is set by both shared and versioned[1] for 14; give it one home",
      "contact.email is set by both shared and versioned[1] for 15; give it one home",
    ]);
  });

  it("rejects two fragments setting the same array for a version", () => {
    const raw = minimal();
    raw.versioned.push({ versions: ["0.13"], issue_report_channels: ["twitter"] } as never);
    expect(problems(raw)).toContain(
      "issue_report_channels is set by both versioned[0] and versioned[1] for 0.13; give it one home",
    );
  });

  it("rejects replacing a shared object with a value", () => {
    const raw = minimal();
    raw.versioned.push({ versions: ["15"], location: "Rotterdam" } as never);
    expect(problems(raw)).toContain("location is set by both shared and versioned[1] for 15; give it one home");
  });

  it.each([
    ["api", { api: "0.13" }],
    ["api_compatibility", { api_compatibility: ["15"] }],
    ["open", { open: true }],
    ["state.open", { state: { open: true } }],
    ["state.lastchange", { state: { lastchange: 1 } }],
  ])("rejects %s, which the service fills in", (path, extra) => {
    const raw = minimal();
    Object.assign(raw.shared, extra);
    expect(problems(raw)).toContain(`shared.${path} is filled in by the service; remove it`);
  });

  it("rejects a version it does not serve", () => {
    const raw = minimal();
    raw.versioned.push({ versions: ["16"] } as never);
    expect(problems(raw)).toHaveLength(1);
    expect(problems(raw)[0]).toMatch(/versions must be among 0\.13, 14, 15/);
  });

  it("rejects an unquoted number as a version", () => {
    const raw = minimal();
    raw.versioned.push({ versions: [14] } as never);
    expect(problems(raw)[0]).toMatch(/quote them/);
  });

  it("rejects unknown top-level keys", () => {
    expect(problems({ ...minimal(), extra: {} })).not.toEqual([]);
  });

  it("rejects a key tagged for a version that does not define it", () => {
    const raw = minimal();
    raw.versioned[0]!.versions.push("15");
    expect(problems(raw)).toContain(
      "SpaceAPI 15: issue_report_channels is not part of SpaceAPI 15 (tag it for the versions that have it, or prefix it ext_)",
    );
  });

  it("rejects a key no version defines, at any depth, unless it is ext_", () => {
    const raw = minimal();
    Object.assign(raw.shared.contact, { discord: "https://discord.gg/x" });
    expect(problems(raw)).toContain(
      "SpaceAPI 14: contact.discord is not part of SpaceAPI 14 (tag it for the versions that have it, or prefix it ext_)",
    );

    const renamed = minimal();
    Object.assign(renamed.shared.contact, { ext_discord: "https://discord.gg/x" });
    expect(problems(renamed)).toEqual([]);
  });

  it("rejects a missing required field per version", () => {
    const raw = minimal();
    raw.versioned = [];
    expect(problems(raw)).toEqual(["SpaceAPI 0.13: (document) must have required property 'issue_report_channels'"]);
  });

  it("rejects a wrong type, naming the field", () => {
    const raw = minimal();
    raw.versioned.push({
      versions: ["15"],
      membership_plans: [{ name: "Member", value: "32.50", currency: "EUR", billing_interval: "monthly" }],
    } as never);
    expect(problems(raw)).toEqual(["SpaceAPI 15: membership_plans.0.value must be number"]);
  });

  it("requires shared.space, the name notifications use", () => {
    const raw = minimal();
    delete (raw.shared as Record<string, unknown>).space;
    expect(problems(raw)).toContain("shared.space must be the space's name");
  });
});

describe("validateSpaceApiDocument", () => {
  const document = {
    api_compatibility: ["15"],
    space: "Testspace",
    logo: "https://example.org/logo.png",
    url: "https://example.org",
    contact: { email: "board@example.org" },
    issue_report_channels: ["email"],
  };

  it("official mode accepts keys the schema does not define, as the published schema does", () => {
    expect(validateSpaceApiDocument("15", document, "official")).toEqual([]);
  });

  it("strict mode rejects them", () => {
    expect(validateSpaceApiDocument("15", document, "strict")).toHaveLength(1);
  });
});
