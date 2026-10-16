import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

export interface TableClients {
  stateHistory: TableClient;
  currentState: TableClient;
}

const STATE_HISTORY_TABLE = "StateHistory";
const CURRENT_STATE_TABLE = "CurrentState";

/**
 * AZURE_STORAGE_CONNECTION_STRING selects local dev/test mode (Azurite).
 * Otherwise AZURE_STORAGE_ACCOUNT_NAME + the Container App's managed
 * identity is used, matching the config blob's auth story.
 */
export function createTableClients(): TableClients {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    // Azurite serves plain HTTP; the SDK's HTTP pipeline refuses insecure
    // connections unless explicitly opted in. Only reachable on this local
    // dev/test path — production always uses HTTPS + managed identity below.
    const options = { allowInsecureConnection: true };
    return {
      stateHistory: TableClient.fromConnectionString(connectionString, STATE_HISTORY_TABLE, options),
      currentState: TableClient.fromConnectionString(connectionString, CURRENT_STATE_TABLE, options),
    };
  }

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error(
      "Set AZURE_STORAGE_ACCOUNT_NAME (production) or AZURE_STORAGE_CONNECTION_STRING (local dev/tests against Azurite)",
    );
  }

  const credential = new DefaultAzureCredential();
  const tableUrl = (table: string) => `https://${accountName}.table.core.windows.net/${table}`;
  return {
    stateHistory: new TableClient(tableUrl(STATE_HISTORY_TABLE), STATE_HISTORY_TABLE, credential),
    currentState: new TableClient(tableUrl(CURRENT_STATE_TABLE), CURRENT_STATE_TABLE, credential),
  };
}
