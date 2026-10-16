/**
 * Pull a live config blob, edit it locally, review the diff, then push it back.
 * Usage: npm run edit-config -- <spaceapi|api-keys|legacy> [--account NAME] [--container NAME] [--dry-run]
 * Needs the Azure CLI (`az login`). The account defaults to $SPACESTATE_STORAGE_ACCOUNT.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { load as parseYaml } from "js-yaml";
import type { ZodType } from "zod";
import { apiKeysConfigSchema, legacyConfigSchema, spaceApiConfigSchema } from "../src/config/schema.ts";

const CONFIGS: Record<string, { blob: string; schema: ZodType }> = {
  spaceapi: { blob: "spaceapi.json", schema: spaceApiConfigSchema },
  "api-keys": { blob: "api-keys.yaml", schema: apiKeysConfigSchema },
  legacy: { blob: "legacy.yaml", schema: legacyConfigSchema },
};

const dir = mkdtempSync(join(tmpdir(), "spacestate-config-"));

try {
  await run(dir);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

async function run(dir: string): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = CONFIGS[args.name];
  const account = args.account ?? process.env.SPACESTATE_STORAGE_ACCOUNT;
  if (!account) throw new Error("Pass --account or set SPACESTATE_STORAGE_ACCOUNT.");

  const original = join(dir, `original-${config.blob}`);
  const edited = join(dir, config.blob);
  const blobArgs = [
    "--account-name", account,
    "--container-name", args.container,
    "--name", config.blob,
    "--auth-mode", "login",
  ];

  process.stdout.write(`Pulling ${config.blob} from ${account}/${args.container}…\n`);
  az(["storage", "blob", "download", ...blobArgs, "--file", original, "--no-progress", "--output", "none"]);
  copyFileSync(original, edited);

  for (;;) {
    const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
    const edit = spawnSync(`${editor} "${edited}"`, { shell: true, stdio: "inherit" });
    if (edit.status !== 0) throw new Error(`Editor exited with status ${edit.status}.`);

    const problem = validate(edited, config.schema);
    if (problem === undefined) break;
    process.stderr.write(`Invalid config:\n${problem}\n`);
    if (!(await confirm("Edit again?"))) throw new Error("Aborted; nothing pushed.");
  }

  const diff = spawnSync("git", ["diff", "--no-index", "--color=auto", "--", original, edited], {
    stdio: "inherit",
  });
  if (diff.status === 0) {
    process.stdout.write("No changes; nothing to push.\n");
    return;
  }
  if (diff.status !== 1) throw new Error("Could not compute diff.");

  if (args.dryRun) {
    process.stdout.write("Dry run; nothing pushed.\n");
    return;
  }
  if (!(await confirm(`Push to PRODUCTION (${account}/${args.container}/${config.blob})?`))) {
    process.stdout.write("Aborted; nothing pushed.\n");
    return;
  }

  az(["storage", "blob", "upload", ...blobArgs, "--file", edited, "--overwrite", "--no-progress", "--output", "none"]);
  process.stdout.write("Pushed. The app picks it up within a few minutes (or on next cold start).\n");
}

function validate(path: string, schema: ZodType): string | undefined {
  try {
    schema.parse(parseYaml(readFileSync(path, "utf8")));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function az(args: readonly string[]): void {
  execFileSync("az", args, { stdio: ["ignore", "inherit", "inherit"] });
}

function parseArgs(argv: string[]): {
  name: string;
  account?: string;
  container: string;
  dryRun: boolean;
} {
  let name: string | undefined;
  let account: string | undefined;
  let container = "config";
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--account" || arg === "--container") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      if (arg === "--account") account = value;
      else container = value;
      i += 1;
      continue;
    }
    if (arg !== undefined && !arg.startsWith("-") && name === undefined) {
      name = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (name === undefined || !(name in CONFIGS)) {
    throw new Error(`Usage: edit-config <${Object.keys(CONFIGS).join("|")}> [--account NAME] [--container NAME] [--dry-run]`);
  }
  return { name, account, container, dryRun };
}
