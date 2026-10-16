import { isRestError } from "@azure/core-rest-pipeline";
import type { TableClient } from "@azure/data-tables";
import * as Sentry from "@sentry/node";
import type { CurrentStateSnapshot, CurrentStateStore } from "../domain/state/types.js";

// Fixed key: a point read against a known PartitionKey/RowKey is an O(1),
// strongly-consistent lookup — exactly what the frequently-polled state
// endpoints need, versus scanning StateHistory for "the latest row".
const PARTITION_KEY = "current";
const ROW_KEY = "state";

export class TableCurrentStateStore implements CurrentStateStore {
  constructor(private readonly client: TableClient) {}

  async get(): Promise<CurrentStateSnapshot | undefined> {
    return Sentry.startSpan({ name: "CurrentState.get", op: "db.table.get" }, async () => {
      try {
        const entity = await this.client.getEntity(PARTITION_KEY, ROW_KEY);
        return {
          state: entity.state as CurrentStateSnapshot["state"],
          changedAt: entity.changedAt as string,
          changedBy: entity.changedBy as string,
          method: entity.method as string,
          source: entity.source as CurrentStateSnapshot["source"],
        };
      } catch (err) {
        if (isRestError(err) && err.statusCode === 404) return undefined;
        throw err;
      }
    });
  }

  async set(snapshot: CurrentStateSnapshot): Promise<void> {
    await Sentry.startSpan({ name: "CurrentState.set", op: "db.table.upsert" }, async () => {
      await this.client.upsertEntity(
        {
          partitionKey: PARTITION_KEY,
          rowKey: ROW_KEY,
          state: snapshot.state,
          changedAt: snapshot.changedAt,
          changedBy: snapshot.changedBy,
          method: snapshot.method,
          source: snapshot.source,
        },
        "Replace",
      );
    });
  }

  async clear(): Promise<void> {
    await Sentry.startSpan({ name: "CurrentState.clear", op: "db.table.delete" }, async () => {
      try {
        await this.client.deleteEntity(PARTITION_KEY, ROW_KEY);
      } catch (err) {
        if (isRestError(err) && err.statusCode === 404) return;
        throw err;
      }
    });
  }
}
