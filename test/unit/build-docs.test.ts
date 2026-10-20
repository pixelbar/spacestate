import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The site is built from docs/openapi.yaml by VitePress, which is too slow to
 * run here. These cover the part that turns the spec into the site's inputs —
 * and the spec hygiene that silently breaks other toolchains.
 */
beforeAll(() => {
  execFileSync("npx", ["tsx", "scripts/build-docs.ts", "--prepare-only"], { stdio: "pipe" });
});

describe("docs site build", () => {
  it("ships the spec verbatim, so editing it is the whole update", () => {
    expect(readFileSync("docs/public/openapi.yaml", "utf8")).toBe(
      readFileSync("docs/openapi.yaml", "utf8"),
    );
  });

  it("gives every operation a tag, so none lands in an untitled group", () => {
    const spec = JSON.parse(readFileSync("docs/.vitepress/openapi.json", "utf8"));
    const operations = Object.values(spec.paths as Record<string, Record<string, { tags?: string[] }>>)
      .flatMap((item) => Object.entries(item))
      .filter(([method]) => method !== "parameters");

    expect(operations.length).toBeGreaterThan(0);
    for (const [, operation] of operations) expect(operation.tags ?? []).not.toHaveLength(0);
  });

  it("rejects YAML merge keys, which most parsers drop on the floor", () => {
    expect(readFileSync("docs/openapi.yaml", "utf8")).not.toMatch(/^\s*(<<:\s*\*|[\w-]+:\s*&)/m);
  });
});
