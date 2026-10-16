import { isRestError } from "@azure/core-rest-pipeline";
import { TableServiceClient } from "@azure/data-tables";

// Well-known Azurite development credential (published by Microsoft for
// local emulator use) — not a secret.
export const AZURITE_CONNECTION_STRING =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

export function applyAzuriteEnv(): void {
  process.env.AZURE_STORAGE_CONNECTION_STRING ??= AZURITE_CONNECTION_STRING;
  process.env.CONFIG_SOURCE ??= "file://./config/space.sample.yaml";
}

/** Deletes and recreates the test tables so each integration run starts from a clean slate. */
export async function resetTestTables(): Promise<void> {
  const client = TableServiceClient.fromConnectionString(AZURITE_CONNECTION_STRING, {
    allowInsecureConnection: true,
  });
  for (const table of ["StateHistory", "CurrentState"]) {
    try {
      await client.deleteTable(table);
    } catch (err) {
      if (!(isRestError(err) && err.statusCode === 404)) throw err;
    }
    await client.createTable(table);
  }
}
