import { describe, expect, it } from "vitest";
import { spaceConfigSchema } from "../../src/config/schema.js";
import { buildSpaceApiDocument } from "../../src/domain/spaceapi/builder.js";

const baseConfig = spaceConfigSchema.parse({
  space: {
    name: "Pixelbar",
    logo: "https://pixelbar.nl/logo.png",
    url: "https://pixelbar.nl",
    address: "Rotterdam",
    location: { lon: 4.4458, lat: 51.9078 },
    contact: { email: "info@pixelbar.nl" },
  },
});

describe("buildSpaceApiDocument", () => {
  it("reports open and sets lastchange from the state timestamp", () => {
    const changedAt = "2026-01-01T12:00:00.000Z";
    const doc = buildSpaceApiDocument(baseConfig, {
      state: "open",
      changedAt,
      changedBy: "alice",
      method: "api",
      source: "api",
    });

    expect(doc.api).toBe("0.13");
    expect(doc.open).toBe(true);
    expect(doc.state).toEqual({
      open: true,
      icon: doc.icon,
      lastchange: Math.floor(new Date(changedAt).getTime() / 1000),
    });
  });

  it("defaults spacefed to all-false when not configured", () => {
    const doc = buildSpaceApiDocument(baseConfig, {
      state: "open",
      changedAt: new Date().toISOString(),
      changedBy: "alice",
      method: "api",
      source: "api",
    });

    expect(doc.spacefed).toEqual({ spacenet: false, spacesaml: false, spacephone: false });
  });

  it("omits optional contact fields and keymasters when not configured", () => {
    const doc = buildSpaceApiDocument(baseConfig, {
      state: "closed",
      changedAt: new Date().toISOString(),
      changedBy: "system",
      method: "default",
      source: "api",
    });

    expect(doc.contact).toEqual({ email: "info@pixelbar.nl" });
    expect(doc.contact.keymasters).toBeUndefined();
  });
});
