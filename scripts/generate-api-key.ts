/**
 * Generate an API key and print the api-keys.yaml entry for it.
 * Usage: just api-key <id> [--role read|write] [--add]
 *   --add  append the entry to config/prod/api-keys.yaml (then `just push api-keys`)
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { load as parseYaml } from "js-yaml";
import { apiKeysConfigSchema } from "../src/config/schema.ts";

const API_KEYS_FILE = "config/prod/api-keys.yaml";

try {
  const args = parseArgs(process.argv.slice(2));
  const key = randomBytes(24).toString("hex");
  const entry = `  - id: "${args.id}"\n    key: "${key}"\n    role: "${args.role}"\n`;

  if (!args.add) {
    process.stdout.write(`apiKeys:\n${entry}`);
    process.exit(0);
  }

  const current = existsSync(API_KEYS_FILE) ? readFileSync(API_KEYS_FILE, "utf8") : "apiKeys:\n";
  const existing = apiKeysConfigSchema.parse(parseYaml(current)).apiKeys;
  if (existing.some((e) => e.id === args.id)) throw new Error(`Key id "${args.id}" already exists.`);

  const next = `${current.endsWith("\n") ? current : `${current}\n`}${entry}`;
  apiKeysConfigSchema.parse(parseYaml(next));
  mkdirSync(dirname(API_KEYS_FILE), { recursive: true });
  writeFileSync(API_KEYS_FILE, next);
  process.stdout.write(`Added "${args.id}" (${args.role}) to ${API_KEYS_FILE}. Key: ${key}\n`);
  process.stdout.write("Push it live with: just push api-keys\n");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { id: string; role: "read" | "write"; add: boolean } {
  let id: string | undefined;
  let role: "read" | "write" = "read";
  let add = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--add") {
      add = true;
      continue;
    }
    if (arg === "--role") {
      const value = argv[i + 1];
      if (value !== "read" && value !== "write") throw new Error("--role must be read or write.");
      role = value;
      i += 1;
      continue;
    }
    if (arg !== undefined && !arg.startsWith("-") && id === undefined) {
      id = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (id === undefined || !/^[\w.-]+$/.test(id)) {
    throw new Error("Usage: api-key <id> [--role read|write] [--add] (id: letters, digits, . _ -)");
  }
  return { id, role, add };
}
