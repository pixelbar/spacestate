/**
 * Checks spaceapi.yaml files against the official SpaceAPI schemas: renders
 * every version, open and closed, and validates each against its schema both
 * as published and in strict mode (see src/domain/spaceapi/validate.ts).
 *
 * Usage: just check-spaceapi [file...] [--print VERSION]
 *   file             defaults to config/spaceapi.sample.yaml; e.g. config/prod/spaceapi.yaml after `just pull`
 *   --print VERSION  also print that version's document (13, 14, 15) as an endpoint would serve it
 */
import { readFileSync } from "node:fs";
import { load as parseYaml } from "js-yaml";
import { spaceApiConfigSchema } from "../src/config/schema.ts";
import { buildSpaceApiDocument } from "../src/domain/spaceapi/builder.ts";
import { validateSpaceApiDocument } from "../src/domain/spaceapi/validate.ts";
import { parseSpaceApiVersion, SPACEAPI_VERSIONS, type SpaceApiVersion } from "../src/domain/spaceapi/versions.ts";

const files: string[] = [];
let print: SpaceApiVersion | undefined;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]!;
  if (arg === "--print") {
    print = parseSpaceApiVersion(argv[i + 1] ?? "");
    if (!print) fail(`--print needs one of ${SPACEAPI_VERSIONS.join(", ")}.`);
    i += 1;
  } else if (arg.startsWith("-")) {
    fail(`Unknown argument: ${arg}\nUsage: check-spaceapi [file...] [--print VERSION]`);
  } else {
    files.push(arg);
  }
}
if (files.length === 0) files.push("config/spaceapi.sample.yaml");

let failed = false;
for (const file of files) {
  process.stdout.write(`== ${file}\n`);
  const result = spaceApiConfigSchema.safeParse(parseYaml(readFileSync(file, "utf8")));
  if (!result.success) {
    failed = true;
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      process.stdout.write(`  ✗ ${path}${issue.message}\n`);
    }
    continue;
  }

  for (const version of SPACEAPI_VERSIONS) {
    const problems = new Set<string>();
    for (const state of ["open", "closed"] as const) {
      const document = buildSpaceApiDocument(result.data, version, { state, changedAt: new Date().toISOString() });
      for (const mode of ["official", "strict"] as const) {
        for (const problem of validateSpaceApiDocument(version, document, mode)) problems.add(`${mode}: ${problem}`);
      }
    }
    if (problems.size === 0) {
      const keys = Object.keys(result.data.documents[version]).length;
      process.stdout.write(`  ✓ SpaceAPI ${version}: valid (official and strict), ${keys} configured top-level keys\n`);
    } else {
      failed = true;
      for (const problem of problems) process.stdout.write(`  ✗ SpaceAPI ${version}: ${problem}\n`);
    }
  }

  if (print) {
    const document = buildSpaceApiDocument(result.data, print, { state: "open", changedAt: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  }
}
process.exitCode = failed ? 1 : 0;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
