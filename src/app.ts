import Fastify, { type FastifyInstance } from "fastify";
import { apiPlugin } from "./api/plugin.js";
import { ConfigStore, yamlParser } from "./config/loader.js";
import {
  apiKeysConfigSchema,
  type ApiKeysConfig,
  type LegacyConfig,
  type SpaceApiConfig,
  legacyConfigSchema,
  spaceApiConfigSchema,
} from "./config/schema.js";
import { createConfigSource } from "./config/sources/index.js";
import { HistoryService } from "./domain/history/service.js";
import { StateService } from "./domain/state/service.js";
import { legacyPlugin } from "./legacy/plugin.js";
import { healthPlugin } from "./plugins/health.js";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { TableCurrentStateStore } from "./storage/currentStateTable.js";
import { TableHistoryStore } from "./storage/historyTable.js";
import { createTableClients } from "./storage/tableClients.js";

export interface BuiltApp {
  app: FastifyInstance;
  spaceApiStore: ConfigStore<SpaceApiConfig>;
  apiKeyStore: ConfigStore<ApiKeysConfig>;
  legacyStore: ConfigStore<LegacyConfig>;
}

export async function buildApp(): Promise<BuiltApp> {
  const spaceApiStore = await ConfigStore.create(
    createConfigSource(process.env.SPACEAPI_CONFIG_SOURCE ?? "file://./config/spaceapi.sample.json"),
    yamlParser(spaceApiConfigSchema),
  );
  const apiKeyStore = await ConfigStore.create(
    createConfigSource(process.env.API_KEYS_CONFIG_SOURCE ?? "file://./config/api-keys.sample.yaml"),
    yamlParser(apiKeysConfigSchema),
  );
  const legacyStore = await ConfigStore.create(
    createConfigSource(process.env.LEGACY_CONFIG_SOURCE ?? "file://./config/legacy.sample.yaml"),
    yamlParser(legacyConfigSchema),
  );

  const tableClients = createTableClients();
  const historyStore = new TableHistoryStore(tableClients.stateHistory);
  const currentStateStore = new TableCurrentStateStore(tableClients.currentState);

  const stateService = new StateService(currentStateStore, historyStore);
  const historyService = new HistoryService(historyStore);

  const app = Fastify({ logger: true });

  registerErrorHandler(app);
  await app.register(healthPlugin);
  await app.register(apiPlugin, { spaceApiStore, apiKeyStore, stateService, historyService });
  await app.register(legacyPlugin, { spaceApiStore, legacyStore, stateService });

  app.addHook("onClose", async () => {
    await Promise.all([spaceApiStore.close(), apiKeyStore.close(), legacyStore.close()]);
  });

  return { app, spaceApiStore, apiKeyStore, legacyStore };
}
