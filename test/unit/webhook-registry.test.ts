import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileConfigSource } from "../../src/config/sources/fileSource.js";
import { MAX_WEBHOOKS, WebhookRegistry } from "../../src/domain/webhooks/registry.js";

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), "webhook-registry-")), "webhooks.yaml");
  return { path, source: new FileConfigSource(path) };
}

describe("WebhookRegistry", () => {
  it("starts empty when the document does not exist yet", async () => {
    const registry = await WebhookRegistry.create(setup().source, 0);
    expect(registry.list()).toEqual([]);
  });

  it("persists registrations as YAML that a fresh registry reads back", async () => {
    const { path, source } = setup();
    const registry = await WebhookRegistry.create(source, 0);

    const result = await registry.register({ url: "https://a.example/hook", description: "A", createdBy: "k1" });
    expect(result.kind).toBe("created");

    expect(readFileSync(path, "utf8")).toContain("url: https://a.example/hook");
    const reloaded = await WebhookRegistry.create(new FileConfigSource(path), 0);
    expect(reloaded.list()).toEqual(registry.list());
    expect(reloaded.list()[0]!.secret.length).toBeGreaterThanOrEqual(16);
  });

  it("refuses a URL that is already registered", async () => {
    const registry = await WebhookRegistry.create(setup().source, 0);
    await registry.register({ url: "https://a.example/hook", createdBy: "k1" });
    const again = await registry.register({ url: "https://a.example/hook", createdBy: "k2" });
    expect(again.kind).toBe("duplicate");
    expect(registry.list()).toHaveLength(1);
  });

  it("removes by id and reports unknown ids", async () => {
    const registry = await WebhookRegistry.create(setup().source, 0);
    const created = await registry.register({ url: "https://a.example/hook", createdBy: "k1" });
    if (created.kind !== "created") throw new Error("expected created");

    expect(await registry.remove("wh_nope")).toBe(false);
    expect(await registry.remove(created.webhook.id)).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it("enforces the registration limit", async () => {
    const registry = await WebhookRegistry.create(setup().source, 0);
    for (let i = 0; i < MAX_WEBHOOKS; i++) {
      await registry.register({ url: `https://a.example/${i}`, createdBy: "k1" });
    }
    expect((await registry.register({ url: "https://a.example/one-more", createdBy: "k1" })).kind).toBe("limit");
  });

  it("retries on a write conflict instead of losing the other writer's entry", async () => {
    const { source } = setup();
    const other = await WebhookRegistry.create(source, 0);
    const registry = await WebhookRegistry.create(source, 0);

    // Make the first save lose a race: another replica registers in between.
    const realSave = source.save.bind(source);
    let raced = false;
    source.save = async (text, version) => {
      if (!raced) {
        raced = true;
        await other.register({ url: "https://other.example/hook", createdBy: "k2" });
      }
      return realSave(text, version);
    };

    await registry.register({ url: "https://mine.example/hook", createdBy: "k1" });
    const urls = (await WebhookRegistry.create(source, 0)).list().map((w) => w.url).sort();
    expect(urls).toEqual(["https://mine.example/hook", "https://other.example/hook"]);
  });
});
