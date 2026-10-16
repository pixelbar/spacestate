/**
 * Sync the live config blobs with config/prod/ (gitignored), always showing a diff first.
 * Usage: just pull [name] | just push [name] | just edit <name>   (name: spaceapi|api-keys|legacy; omit for all)
 *   pull  diff remote → local, ask before overwriting the local file
 *   push  validate local, diff remote → local, ask before overwriting the remote blob
 *   edit  like push, but opens the remote version in $EDITOR first (result is also saved locally)
 * Options: [--account NAME] [--container NAME] [--dry-run]
 * Needs the Azure CLI (`az login`). The account defaults to $SPACESTATE_STORAGE_ACCOUNT.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { load as parseYaml } from "js-yaml";
import type { ZodType } from "zod";
import { apiKeysConfigSchema, legacyConfigSchema, spaceApiConfigSchema } from "../src/config/schema.ts";

const LOCAL_DIR = "config/prod";

const CONFIGS: Record<string, { blob: string; schema: ZodType }> = {
  spaceapi: { blob: "spaceapi.json", schema: spaceApiConfigSchema },
  "api-keys": { blob: "api-keys.yaml", schema: apiKeysConfigSchema },
  legacy: { blob: "legacy.yaml", schema: legacyConfigSchema },
};

type Mode = "pull" | "push" | "edit";
type Args = { mode: Mode; names: string[]; account?: string; container: string; dryRun: boolean };

const dir = mkdtempSync(join(tmpdir(), "spacestate-config-"));

try {
  await run(parseArgs(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

async function run(args: Args): Promise<void> {
  const account = args.account ?? process.env.SPACESTATE_STORAGE_ACCOUNT;
  if (!account) throw new Error("Pass --account or set SPACESTATE_STORAGE_ACCOUNT (see .env.example).");
  // Azure storage account names; anything else (placeholders, brackets) makes `az` fail obscurely.
  if (!/^[a-z0-9]{3,24}$/.test(account)) {
    throw new Error(`"${account}" is not a valid storage account name (3-24 lowercase letters/digits).`);
  }

  for (const name of args.names) {
    const { blob, schema } = CONFIGS[name];
    const remote = join(dir, `remote-${blob}`);
    const local = join(LOCAL_DIR, blob);
    const blobArgs = [
      "--account-name", account,
      "--container-name", args.container,
      "--name", blob,
      "--auth-mode", "login",
    ];
    const target = `${account}/${args.container}/${blob}`;

    process.stdout.write(`\n== ${blob} ==\n`);
    az(["storage", "blob", "download", ...blobArgs, "--file", remote, "--no-progress", "--output", "none"]);

    if (args.mode === "pull") {
      if (existsSync(local)) {
        if (showDiff(local, remote) === "same") {
          process.stdout.write("Local is up to date.\n");
          continue;
        }
        if (!(await confirm(`Overwrite local ${local} with the remote version?`))) continue;
      }
      mkdirSync(dirname(local), { recursive: true });
      copyFileSync(remote, local);
      process.stdout.write(`Saved ${local}.\n`);
      continue;
    }

    let source = local;
    if (args.mode === "edit") {
      source = join(dir, blob);
      copyFileSync(remote, source);
      await editUntilValid(source, schema);
    } else {
      if (!existsSync(local)) throw new Error(`${local} not found; run \`just pull ${name}\` first.`);
      const problem = validate(local, schema);
      if (problem !== undefined) throw new Error(`Invalid ${local}:\n${problem}`);
    }

    if (showDiff(remote, source) === "same") {
      process.stdout.write("No changes; nothing to push.\n");
      continue;
    }
    if (args.dryRun) {
      process.stdout.write("Dry run; nothing pushed.\n");
      continue;
    }
    if (!(await confirm(`Overwrite REMOTE ${target} (production)?`))) {
      process.stdout.write("Skipped; nothing pushed.\n");
      continue;
    }
    az(["storage", "blob", "upload", ...blobArgs, "--file", source, "--overwrite", "--no-progress", "--output", "none"]);
    if (source !== local) {
      mkdirSync(dirname(local), { recursive: true });
      copyFileSync(source, local);
    }
    process.stdout.write("Pushed. The app picks it up within a few minutes (or on next cold start).\n");
  }
}

async function editUntilValid(path: string, schema: ZodType): Promise<void> {
  for (;;) {
    const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
    const edit = spawnSync(`${editor} "${path}"`, { shell: true, stdio: "inherit" });
    if (edit.status !== 0) throw new Error(`Editor exited with status ${edit.status}.`);

    const problem = validate(path, schema);
    if (problem === undefined) return;
    process.stderr.write(`Invalid config:\n${problem}\n`);
    if (!(await confirm("Edit again?"))) throw new Error("Aborted; nothing pushed.");
  }
}

function showDiff(from: string, to: string): "same" | "changed" {
  const diff = spawnSync("git", ["diff", "--no-index", "--color=auto", "--", from, to], {
    stdio: "inherit",
  });
  if (diff.status === 0) return "same";
  if (diff.status === 1) return "changed";
  throw new Error("Could not compute diff.");
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

function parseArgs(argv: string[]): Args {
  const usage = `Usage: config <pull|push|edit> [${Object.keys(CONFIGS).join("|")}] [--account NAME] [--container NAME] [--dry-run]`;
  const positional: string[] = [];
  let account: string | undefined;
  let container = "config";
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--account" || arg === "--container") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      if (arg === "--account") account = value;
      else container = value;
      i += 1;
    } else if (arg !== undefined && !arg.startsWith("-")) {
      positional.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage}`);
    }
  }
  const [mode, name, ...extra] = positional;
  if ((mode !== "pull" && mode !== "push" && mode !== "edit") || extra.length > 0) throw new Error(usage);
  if (name !== undefined && !(name in CONFIGS)) throw new Error(usage);
  if (mode === "edit" && name === undefined) throw new Error(`edit needs a file name.\n${usage}`);
  return { mode, names: name === undefined ? Object.keys(CONFIGS) : [name], account, container, dryRun };
}
