import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContractApp, type ContractApp } from "../helpers/buildContractApp.js";
import { legacyBody, legacyRecording } from "../helpers/legacyFixtures.js";
import { mediaType } from "./legacyParity.js";

/**
 * The simple state document (`/spacestate.php`) is the one output where
 * byte-identical is achievable, and the tests hold it to that: it is the
 * document the hardware and the old SpaceAPI script polled, and it is two
 * keys long, so there is nothing to trade away.
 */

const legacy = legacyRecording.endpoints.spacestate;

let contract: ContractApp;

beforeAll(async () => {
  contract = await buildContractApp();
});

afterAll(async () => {
  await contract.close();
});

async function spacestate(state: "open" | "closed") {
  contract.seedState(state);
  return contract.app.inject({ method: "GET", url: "/spacestate.php" });
}

describe("/spacestate.php vs the legacy golden fixtures", () => {
  for (const state of ["closed", "open"] as const) {
    it(`is byte-identical to the legacy body when the space is ${state}`, async () => {
      const response = await spacestate(state);

      expect(response.statusCode).toBe(legacy.status);
      expect(response.rawPayload.toString("utf8")).toBe(legacyBody("spacestate", state));
    });
  }

  it("sends no trailing newline, as PHP's echo did not", async () => {
    const response = await spacestate("closed");

    expect(response.rawPayload.toString("utf8")).toBe(String.raw`{"state":"closed"}`);
    expect(response.headers["content-length"]).toBe("18");
  });

  it("falls back to closed when nothing has ever been recorded", async () => {
    // The legacy table always had a row; a fresh deployment of this service
    // does not, and the SpaceAPI document's `open` flag is derived from this
    // value — so the fallback has to be the safe one.
    const fresh = await buildContractApp();
    try {
      const response = await fresh.app.inject({ method: "GET", url: "/spacestate.php" });
      expect(response.rawPayload.toString("utf8")).toBe(legacyBody("spacestate", "closed"));
    } finally {
      await fresh.close();
    }
  });
});

describe("/spacestate.php response headers vs the legacy recording", () => {
  it("sends the CORS and caching headers the legacy endpoint sent", async () => {
    const response = await spacestate("closed");

    expect(response.headers["access-control-allow-origin"]).toBe(
      legacy.headers?.["access-control-allow-origin"],
    );
    expect(response.headers["cache-control"]).toBe(legacy.headers?.["cache-control"]);
  });

  it("keeps the legacy media type, adding only the charset parameter", async () => {
    const response = await spacestate("closed");

    expect(mediaType(response.headers["content-type"])).toBe(
      mediaType(legacy.headers?.["content-type"]),
    );
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
  });
});
