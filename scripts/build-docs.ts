/**
 * Assemble the static API reference published to GitHub Pages.
 * Usage: just docs-build [--out <dir>]
 *
 * The site is two files, copied as-is. The page reads the spec at runtime, so
 * editing docs/openapi.yaml is the whole update: nothing here, and nothing in
 * reference.html, parses or regenerates from the spec.
 */
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const DOCS_DIR = "docs";
const DEFAULT_OUT = join(DOCS_DIR, "dist");

/** Relative so the site works at any base path: /spacestate/ on Pages, / under a local preview. */
const SPEC_HREF = "./openapi.yaml";
const SPEC_FILE = "openapi.yaml";
const PAGE_FILE = "reference.html";

const out = parseOut(process.argv.slice(2)) ?? DEFAULT_OUT;

try {
  const page = await readFile(join(DOCS_DIR, PAGE_FILE), "utf8");
  assertSpecHref(page);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await copyFile(join(DOCS_DIR, PAGE_FILE), join(out, "index.html"));
  await copyFile(join(DOCS_DIR, SPEC_FILE), join(out, SPEC_FILE));

  process.stdout.write(`Built ${out}/ (index.html + ${SPEC_FILE})\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

/**
 * The one way these two files can drift: the page pointing somewhere the build
 * doesn't put the spec. Cheap to check, silent blank page if we don't.
 */
function assertSpecHref(page: string): void {
  if (!page.includes(`url: "${SPEC_HREF}"`)) {
    throw new Error(
      `${DOCS_DIR}/${PAGE_FILE} must load the spec from "${SPEC_HREF}" — that is where this script writes it.`,
    );
  }
}

function parseOut(argv: string[]): string | undefined {
  const i = argv.indexOf("--out");
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (!value) throw new Error("--out needs a directory");
  return value;
}
