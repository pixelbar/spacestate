import { buildApp, type BuiltApp } from "../../src/app.js";
import { applyAzuriteEnv, resetTestTables } from "./azurite.js";

/** Requires Azurite running locally (`docker compose up -d azurite`). */
export async function buildTestApp(): Promise<BuiltApp> {
  applyAzuriteEnv();
  await resetTestTables();
  return buildApp();
}
