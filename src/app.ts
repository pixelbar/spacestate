import Fastify, { type FastifyInstance } from "fastify";
import { apiPlugin } from "./api/plugin.js";
import { ConfigStore } from "./config/loader.js";
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
  configStore: ConfigStore;
}

export async function buildApp(): Promise<BuiltApp> {
  const configSourceUrl = process.env.CONFIG_SOURCE ?? "file://./config/space.sample.yaml";
  const configStore = await ConfigStore.create(createConfigSource(configSourceUrl));

  const tableClients = createTableClients();
  const historyStore = new TableHistoryStore(tableClients.stateHistory);
  const currentStateStore = new TableCurrentStateStore(tableClients.currentState);

  const stateService = new StateService(currentStateStore, historyStore);
  const historyService = new HistoryService(historyStore);

  const app = Fastify({ logger: true });

  registerErrorHandler(app);
  await app.register(healthPlugin);
  await app.register(apiPlugin, { configStore, stateService, historyService });
  await app.register(legacyPlugin, { configStore, stateService });

  app.addHook("onClose", async () => {
    await configStore.close();
  });

  return { app, configStore };
}
