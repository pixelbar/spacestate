import Fastify, { type FastifyInstance } from "fastify";
import { apiPlugin } from "../../src/api/plugin.js";
import { ConfigStore, yamlParser } from "../../src/config/loader.js";
import {
  apiKeysConfigSchema,
  legacyConfigSchema,
  spaceApiConfigSchema,
} from "../../src/config/schema.js";
import { createConfigSource } from "../../src/config/sources/index.js";
import { HistoryService } from "../../src/domain/history/service.js";
import { StateService } from "../../src/domain/state/service.js";
import type { SpaceState } from "../../src/domain/state/types.js";
import { legacyPlugin } from "../../src/legacy/plugin.js";
import { registerErrorHandler } from "../../src/plugins/errorHandler.js";
import { InMemoryCurrentStateStore, InMemoryHistoryStore } from "./inMemoryStores.js";

export interface ContractApp {
  app: FastifyInstance;
  /** Puts the service in a known state without going through an endpoint. */
  seedState(state: SpaceState): void;
  close(): Promise<void>;
}

/**
 * The real routes, config loading and SpaceAPI builder, wired to in-memory
 * stores instead of Table Storage.
 *
 * Deliberately not `buildTestApp()`: that needs Azurite, which the CI `check`
 * job only has for the integration step, and the legacy parity contract is
 * about response bytes and headers — nothing storage decides. Everything that
 * shapes a response (route handlers, `config/*.sample.*` parsing, the
 * SpaceAPI builder, Fastify's serializer) is the production code path.
 */
export async function buildContractApp(): Promise<ContractApp> {
  // pollIntervalMs 0 disables the reload timer: the sample files never change
  // under a test run, and a live timer would keep the process awake.
  const spaceApiStore = await ConfigStore.create(
    createConfigSource("file://./config/spaceapi.sample.json"),
    yamlParser(spaceApiConfigSchema),
    0,
  );
  const apiKeyStore = await ConfigStore.create(
    createConfigSource("file://./config/api-keys.sample.yaml"),
    yamlParser(apiKeysConfigSchema),
    0,
  );
  const legacyStore = await ConfigStore.create(
    createConfigSource("file://./config/legacy.sample.yaml"),
    yamlParser(legacyConfigSchema),
    0,
  );

  const currentStateStore = new InMemoryCurrentStateStore();
  const historyStore = new InMemoryHistoryStore();
  const stateService = new StateService(currentStateStore, historyStore);
  const historyService = new HistoryService(historyStore);

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(apiPlugin, { spaceApiStore, apiKeyStore, stateService, historyService });
  await app.register(legacyPlugin, { spaceApiStore, legacyStore, stateService });
  await app.ready();

  return {
    app,
    seedState(state) {
      currentStateStore.snapshot = {
        state,
        changedAt: "2026-10-20T13:03:35.000Z",
        changedBy: "contract-test",
        method: "Manual Switch",
        source: "legacy",
      };
    },
    async close() {
      await app.close();
      await Promise.all([spaceApiStore.close(), apiKeyStore.close(), legacyStore.close()]);
    },
  };
}
