import { describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  logger: { warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@sentry/node", () => sentry);

import { findLegacyDevice } from "../../src/auth/legacyToken.js";
import { legacyConfigSchema } from "../../src/config/schema.js";
import { authenticateLegacyRequest } from "../../src/legacy/auth.js";

const config = legacyConfigSchema.parse({
  legacyDevices: [
    { shortname: "Pixelbar Rotterdam", method: "Manual Switch", token: "token-manual" },
    // Still carries the retired `ip` field, as deployed blobs do.
    { shortname: "Wireless Spacestate Button", method: "Spacestate Switch", ip: "203.0.113.11", token: "token-button" },
  ],
});

describe("legacy device lookup", () => {
  it("matches on the token alone", () => {
    expect(findLegacyDevice(config, "token-manual")?.shortname).toBe("Pixelbar Rotterdam");
  });

  it("matches a device whose config still carries the ignored ip field", () => {
    expect(findLegacyDevice(config, "token-button")?.shortname).toBe("Wireless Spacestate Button");
  });

  it("does not match an unknown token", () => {
    expect(findLegacyDevice(config, "nope")).toBeUndefined();
    expect(findLegacyDevice(config, "")).toBeUndefined();
  });

  it("does not match on a prefix of a valid token", () => {
    expect(findLegacyDevice(config, "token-man")).toBeUndefined();
  });
});

describe("authenticateLegacyRequest", () => {
  it("accepts a valid token — the request is not part of the decision", () => {
    expect(authenticateLegacyRequest(config, "token-manual")?.device.method).toBe("Manual Switch");
  });

  it("rejects a wrong token", () => {
    expect(authenticateLegacyRequest(config, "wrong")).toBeUndefined();
  });

  it("rejects everything when no devices are configured", () => {
    const empty = legacyConfigSchema.parse({});
    expect(authenticateLegacyRequest(empty, "token-manual")).toBeUndefined();
  });
});

describe("legacy config schema", () => {
  it("keeps parsing a device blob that still has a per-device ip", () => {
    const parsed = legacyConfigSchema.parse({
      legacyDevices: [{ shortname: "a", method: "b", ip: "203.0.113.10", token: "t" }],
    });
    expect(parsed.legacyDevices[0]?.token).toBe("t");
  });

  it("parses a device with no ip at all", () => {
    const parsed = legacyConfigSchema.parse({
      legacyDevices: [{ shortname: "a", method: "b", token: "t" }],
    });
    expect(parsed.legacyDevices[0]?.ip).toBeUndefined();
  });
});
