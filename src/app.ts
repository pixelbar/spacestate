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
import { NO_NOTIFICATIONS, notificationsConfigSchema, type NotificationsConfig } from "./notifications/config.js";
import { ConfiguredChannels } from "./notifications/configuredChannels.js";
import { NotificationDispatcher } from "./notifications/dispatcher.js";
import { WebhookRegistry } from "./notifications/webhooks/registry.js";
import { WebhookSubscribers } from "./notifications/webhooks/subscribers.js";
import { policyFromEnv } from "./notifications/webhooks/targetPolicy.js";
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
  notificationsStore: ConfigStore<NotificationsConfig>;
  notifications: NotificationDispatcher;
  webhookRegistry: WebhookRegistry;
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
  // Optional, unlike the stores above: announcing a change is a side feature,
  // so a missing or broken document means no announcements, not no service.
  const notificationsStore = await ConfigStore.create(
    createConfigSource(process.env.NOTIFICATIONS_CONFIG_SOURCE ?? "file://./config/notifications.sample.yaml"),
    yamlParser(notificationsConfigSchema),
    { fallback: NO_NOTIFICATIONS },
  );
  // Written by the app (POST /api/v1/webhooks), so unlike the stores above it
  // lives in its own blob container the identity may write to. A missing
  // document just means no webhooks yet.
  const webhookRegistry = await WebhookRegistry.create(
    createConfigSource(process.env.WEBHOOKS_CONFIG_SOURCE ?? "file://./config/prod/webhooks.yaml"),
  );
  const webhookPolicy = policyFromEnv(process.env);

  const tableClients = createTableClients();
  const historyStore = new TableHistoryStore(tableClients.stateHistory);
  const currentStateStore = new TableCurrentStateStore(tableClients.currentState);

  const stateService = new StateService(currentStateStore, historyStore);
  const historyService = new HistoryService(historyStore);

  const notifications = new NotificationDispatcher([
    new ConfiguredChannels(notificationsStore, { space: () => spaceApiStore.get().space }),
    new WebhookSubscribers(webhookRegistry, { policy: webhookPolicy }),
  ]);
  stateService.onChange((event) => notifications.notify(event));

  const app = Fastify({ logger: true });

  registerErrorHandler(app);
  await app.register(healthPlugin);
  await app.register(apiPlugin, {
    spaceApiStore,
    apiKeyStore,
    stateService,
    historyService,
    webhookRegistry,
    webhookPolicy,
  });
  await app.register(legacyPlugin, { spaceApiStore, legacyStore, stateService });

  app.addHook("onClose", async () => {
    webhookRegistry.close();
    await Promise.all([
      spaceApiStore.close(),
      apiKeyStore.close(),
      legacyStore.close(),
      notificationsStore.close(),
      notifications.close(),
    ]);
  });

  return { app, spaceApiStore, apiKeyStore, legacyStore, notificationsStore, notifications, webhookRegistry };
}
