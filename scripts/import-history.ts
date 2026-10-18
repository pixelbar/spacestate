/**
 * Import the old SpaceStateScripts MySQL history into the StateHistory table.
 * Usage: just import-history <dump.sql> [--apply] [--account NAME]
 *   Without --apply this is a dry run: parses the dump, prints a summary, writes nothing.
 *   --account  storage account (default $SPACESTATE_STORAGE_ACCOUNT). Needs `az login`
 *              and Storage Table Data Contributor. Set AZURE_STORAGE_CONNECTION_STRING
 *              instead to target Azurite.
 *
 * Safe to re-run: RowKeys are derived from the legacy row id, so rows that
 * already exist are skipped. CurrentState is never touched.
 */
import { readFileSync } from "node:fs";
import { TableClient, type TableEntity } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

const TABLE = "StateHistory";
const BATCH_SIZE = 100; // Table Storage transaction limit (one partition per batch)
const INVERTED_MAX = 99_999_999_999_999; // keep in sync with src/storage/historyTable.ts

interface LegacyRow {
  id: number;
  state: "open" | "closed";
  user: string;
  method: string;
  changedAt: string;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const rows = parseStateRows(readFileSync(args.file).toString("latin1")); // dump is latin1
  const entities = rows.map(toEntity);
  printSummary(rows, entities);

  if (!args.apply) {
    process.stdout.write("\nDry run — nothing written. Re-run with --apply to import.\n");
    process.exit(0);
  }

  const client = createClient(args.account);
  process.stdout.write(`\nImporting into ${client.url} / ${TABLE} ...\n`);
  await client.createTable(); // no-op if it already exists
  const { created, existing } = await importEntities(client, entities);
  process.stdout.write(`Done: ${created} created, ${existing} already present.\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { file: string; apply: boolean; account?: string } {
  let file: string | undefined;
  let apply = false;
  let account = process.env.SPACESTATE_STORAGE_ACCOUNT || undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--account") {
      account = argv[i + 1];
      i += 1;
    } else if (arg !== undefined && !arg.startsWith("-") && file === undefined) {
      file = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (file === undefined) throw new Error("Usage: import-history <dump.sql> [--apply] [--account NAME]");
  return { file, apply, account };
}

/** Pull the `state` table's rows out of a mysqldump file. */
function parseStateRows(sql: string): LegacyRow[] {
  const rows: LegacyRow[] = [];
  const insert = /^INSERT INTO `state` VALUES /gm;
  let match: RegExpExecArray | null;
  while ((match = insert.exec(sql)) !== null) {
    for (const values of parseTuples(sql, insert.lastIndex)) {
      const [id, state, user, method, timestamp] = values;
      if (typeof id !== "number" || (state !== "open" && state !== "closed")) {
        throw new Error(`Unexpected state row: ${JSON.stringify(values)}`);
      }
      if (typeof user !== "string" || typeof method !== "string" || typeof timestamp !== "string") {
        throw new Error(`Unexpected state row: ${JSON.stringify(values)}`);
      }
      // mysqldump sets TIME_ZONE='+00:00', so TIMESTAMP columns are dumped in UTC.
      const changedAt = new Date(`${timestamp.replace(" ", "T")}Z`);
      if (Number.isNaN(changedAt.getTime())) throw new Error(`Bad timestamp in row ${id}: ${timestamp}`);
      rows.push({ id, state, user, method, changedAt: changedAt.toISOString() });
    }
  }
  if (rows.length === 0) throw new Error("No INSERT INTO `state` rows found — is this the right dump?");
  return rows;
}

type SqlValue = number | string | null;

/** Parse `(1,'a',NULL),(2,...);` starting at `pos`, stopping at the terminating `;`. */
function* parseTuples(sql: string, start: number): Generator<SqlValue[]> {
  let i = start;
  while (sql[i] === "(") {
    i += 1;
    const values: SqlValue[] = [];
    for (;;) {
      if (sql[i] === "'") {
        let text = "";
        i += 1;
        for (;;) {
          const ch = sql[i];
          if (ch === undefined) throw new Error("Unterminated string in dump");
          if (ch === "\\") {
            const next = sql[i + 1] ?? "";
            text += ({ n: "\n", r: "\r", t: "\t", "0": "\0" } as Record<string, string>)[next] ?? next;
            i += 2;
          } else if (ch === "'" && sql[i + 1] === "'") {
            text += "'";
            i += 2;
          } else if (ch === "'") {
            i += 1;
            break;
          } else {
            text += ch;
            i += 1;
          }
        }
        values.push(text);
      } else {
        const end = sql.slice(i).search(/[,)]/);
        const token = sql.slice(i, i + end);
        values.push(token === "NULL" ? null : Number(token));
        i += end;
      }
      if (sql[i] === ",") {
        i += 1;
        continue;
      }
      if (sql[i] === ")") {
        i += 1;
        break;
      }
      throw new Error(`Malformed dump near offset ${i}`);
    }
    yield values;
    if (sql[i] === ",") i += 1;
  }
}

function toEntity(row: LegacyRow): TableEntity {
  const inverted = (INVERTED_MAX - new Date(row.changedAt).getTime()).toString().padStart(14, "0");
  return {
    partitionKey: row.changedAt.slice(0, 7), // "YYYY-MM"
    // Deterministic (unlike the app's random suffix) so re-runs are idempotent.
    rowKey: `${inverted}-legacy${String(row.id).padStart(8, "0")}`,
    state: row.state,
    user: row.user,
    method: row.method,
    deviceShortname: "",
    source: "legacy",
    changedAt: row.changedAt,
  };
}

function printSummary(rows: LegacyRow[], entities: TableEntity[]): void {
  const times = rows.map((r) => r.changedAt).sort();
  const partitions = new Set(entities.map((e) => e.partitionKey));
  const out = process.stdout;
  out.write(`Parsed ${rows.length} rows, ${times[0]} .. ${times[times.length - 1]}\n`);
  out.write(`  open: ${rows.filter((r) => r.state === "open").length}, closed: ${rows.filter((r) => r.state === "closed").length}\n`);
  out.write(`  ${partitions.size} monthly partitions\n`);
  const sample = entities[entities.length - 1];
  out.write(`  sample: ${JSON.stringify(sample)}\n`);
}

function createClient(account: string | undefined): TableClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return TableClient.fromConnectionString(connectionString, TABLE, { allowInsecureConnection: true });
  }
  if (!account) {
    throw new Error("Pass --account NAME or set SPACESTATE_STORAGE_ACCOUNT (or AZURE_STORAGE_CONNECTION_STRING for Azurite).");
  }
  return new TableClient(`https://${account}.table.core.windows.net`, TABLE, new DefaultAzureCredential());
}

async function importEntities(client: TableClient, entities: TableEntity[]): Promise<{ created: number; existing: number }> {
  const byPartition = new Map<string, TableEntity[]>();
  for (const entity of entities) {
    const list = byPartition.get(entity.partitionKey) ?? [];
    list.push(entity);
    byPartition.set(entity.partitionKey, list);
  }

  let created = 0;
  let existing = 0;
  for (const [partition, list] of [...byPartition].sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const chunk = list.slice(i, i + BATCH_SIZE);
      try {
        await client.submitTransaction(chunk.map((entity) => ["create", entity] as const));
        created += chunk.length;
      } catch (error) {
        if (!isConflict(error)) throw error;
        // A batch fails atomically if any row exists (a previous run); fall back to one by one.
        for (const entity of chunk) {
          try {
            await client.createEntity(entity);
            created += 1;
          } catch (inner) {
            if (!isConflict(inner)) throw inner;
            existing += 1;
          }
        }
      }
    }
    process.stdout.write(`  ${partition}: ${list.length} rows\n`);
  }
  return { created, existing };
}

function isConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; code?: string } | undefined;
  return e?.statusCode === 409 || e?.code === "EntityAlreadyExists";
}
