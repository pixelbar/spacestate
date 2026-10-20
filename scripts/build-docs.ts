/**
 * Build the API reference site published to GitHub Pages.
 * Usage: just docs-build [--prepare-only]
 *
 * docs/openapi.yaml is the only input anyone edits. This turns it into the two
 * artefacts the VitePress site needs — a JSON copy the pages import, and a
 * verbatim copy served alongside them for codegen — then runs VitePress.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

const SPEC = join("docs", "openapi.yaml");
const SPEC_JSON = join("docs", ".vitepress", "openapi.json");
const PUBLIC_SPEC = join("docs", "public", "openapi.yaml");
const VITEPRESS = join("node_modules", ".bin", "vitepress");

try {
  const yaml = await readFile(SPEC, "utf8");
  assertNoAnchors(yaml);

  const spec = parse(yaml) as Spec;
  assertEveryOperationTagged(spec);

  await mkdir(join("docs", ".vitepress"), { recursive: true });
  await mkdir(join("docs", "public"), { recursive: true });
  await writeFile(SPEC_JSON, `${JSON.stringify(spec, null, 2)}\n`);
  await copyFile(SPEC, PUBLIC_SPEC);

  const paths = Object.keys(spec.paths).length;
  process.stdout.write(`Prepared ${SPEC_JSON} and ${PUBLIC_SPEC} (${paths} paths)\n`);

  if (process.argv.includes("--prepare-only")) process.exit(0);

  const built = spawnSync(VITEPRESS, ["build", "docs"], { stdio: "inherit" });
  if (built.error) throw built.error;
  process.exit(built.status ?? 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

interface Spec {
  paths: Record<string, Record<string, { tags?: string[] } | unknown>>;
}

/**
 * YAML 1.2 dropped merge keys from the core schema, so `<<: *x` is silently
 * ignored by most parsers — including this one — and the merged fields vanish
 * for anyone generating a client from the published spec. Refuse them at the
 * source rather than shipping a spec that means different things to different
 * tools.
 */
function assertNoAnchors(yaml: string): void {
  const line = yaml.split("\n").findIndex((text) => /^\s*(<<:\s*\*|[\w-]+:\s*&)/.test(text));
  if (line !== -1) {
    throw new Error(
      `${SPEC}:${line + 1} uses a YAML anchor or merge key. Write the operation out in full, or share it with $ref — see AGENTS.md.`,
    );
  }
}

/** An untagged operation disappears into a "Default" sidebar group nobody looks at. */
function assertEveryOperationTagged(spec: Spec): void {
  const methods = new Set(["get", "put", "post", "delete", "patch", "head", "options"]);
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const tags = (operation as { tags?: string[] }).tags;
      if (!tags?.length) throw new Error(`${SPEC}: ${method.toUpperCase()} ${path} has no tags.`);
    }
  }
}
