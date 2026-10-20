import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let out: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "spacestate-docs-"));
  execFileSync("npx", ["tsx", "scripts/build-docs.ts", "--out", out], { stdio: "pipe" });
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe("docs site build", () => {
  it("emits the page and the spec it loads", () => {
    const page = readFileSync(join(out, "index.html"), "utf8");
    const spec = readFileSync(join(out, "openapi.yaml"), "utf8");

    expect(page).toContain('url: "./openapi.yaml"');
    expect(spec).toMatch(/^openapi: 3\.1\.\d/m);
  });

  it("ships the spec verbatim, so editing it is the whole update", () => {
    expect(readFileSync(join(out, "openapi.yaml"), "utf8")).toBe(
      readFileSync("docs/openapi.yaml", "utf8"),
    );
  });
});
