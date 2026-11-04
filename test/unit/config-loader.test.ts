import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigStore, yamlParser } from "../../src/config/loader.js";
import type { ConfigSource } from "../../src/config/sources/types.js";

const parse = yamlParser(z.object({ n: z.number() }));
const noPolling = { pollIntervalMs: 0 };

const sourceOf = (load: () => Promise<string>): ConfigSource => ({ load });
const missing = sourceOf(async () => {
  throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
});

describe("ConfigStore", () => {
  it("fails to start on a missing document by default", async () => {
    await expect(ConfigStore.create(missing, parse, noPolling)).rejects.toThrow("ENOENT");
  });

  it("starts from the fallback when an optional document is missing", async () => {
    const store = await ConfigStore.create(missing, parse, { ...noPolling, fallback: { n: 0 } });
    expect(store.get()).toEqual({ n: 0 });
  });

  it("starts from the fallback when an optional document is invalid", async () => {
    const store = await ConfigStore.create(sourceOf(async () => "n: nope"), parse, { ...noPolling, fallback: { n: 0 } });
    expect(store.get()).toEqual({ n: 0 });
  });

  it("uses the document when it is there", async () => {
    const store = await ConfigStore.create(sourceOf(async () => "n: 7"), parse, { ...noPolling, fallback: { n: 0 } });
    expect(store.get()).toEqual({ n: 7 });
  });
});
