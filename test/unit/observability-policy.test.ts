import { describe, expect, it } from "vitest";
import { isLevelEnabled, isNotableRequest, logLevel } from "../../src/observability/policy.js";

describe("logLevel", () => {
  it("defaults to info", () => {
    expect(logLevel({})).toBe("info");
    expect(logLevel({ LOG_LEVEL: " " })).toBe("info");
  });

  it("accepts a level in any case", () => {
    expect(logLevel({ LOG_LEVEL: "DEBUG" })).toBe("debug");
  });

  it("rejects an unknown level instead of guessing", () => {
    expect(() => logLevel({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL must be one of/);
  });
});

describe("isLevelEnabled", () => {
  it("passes the threshold and above", () => {
    expect(isLevelEnabled("debug", "info")).toBe(false);
    expect(isLevelEnabled("info", "info")).toBe(true);
    expect(isLevelEnabled("error", "info")).toBe(true);
    expect(isLevelEnabled("debug", "debug")).toBe(true);
  });

  it("passes levels it doesn't know rather than dropping them", () => {
    expect(isLevelEnabled("critical", "fatal")).toBe(true);
  });
});

describe("isNotableRequest", () => {
  it("counts state changes and history reads", () => {
    expect(isNotableRequest("GET", "/togglestate.php")).toBe(true);
    expect(isNotableRequest("POST", "/togglebaker.php")).toBe(true);
    expect(isNotableRequest("POST", "/api/v1/state")).toBe(true);
    expect(isNotableRequest("GET", "/api/v1/history")).toBe(true);
  });

  it("treats polls, health checks and unknown paths as routine", () => {
    for (const path of ["/", "/index.php", "/spacestate.php", "/api/v1/state", "/api/v1/spaceapi", "/healthz", "/state", "/.env"]) {
      expect(isNotableRequest("GET", path), path).toBe(false);
    }
    expect(isNotableRequest(undefined, "/api/v1/state")).toBe(false);
  });
});
