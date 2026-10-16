import { describe, expect, it } from "vitest";
import { LEGACY_ALREADY_TOGGLED, LEGACY_SUCCESS } from "../../src/legacy/responses.js";

describe("legacy response strings", () => {
  it("preserves the historic typo byte-for-byte", () => {
    expect(LEGACY_ALREADY_TOGGLED).toBe("ALLREADY TOGGLED TO THIS STATE");
  });

  it("keeps the plain SUCCESS string", () => {
    expect(LEGACY_SUCCESS).toBe("SUCCESS");
  });
});
