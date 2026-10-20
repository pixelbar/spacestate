import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContractApp, type ContractApp } from "../helpers/buildContractApp.js";
import { legacyBody, legacyRecording } from "../helpers/legacyFixtures.js";
import { canonicalJson, mediaType, unescapeSlashes } from "./legacyParity.js";

/**
 * The SpaceAPI document must match what SpaceApiScripts serves today.
 * "Match" here is JSON-semantic, not byte-identical — see
 * test/contract/README.md for the two deliberate byte differences and why
 * they are allowed.
 */

const SPACEAPI_PATHS = ["/", "/index.php", "/api/v1/spaceapi"] as const;
const legacy = legacyRecording.endpoints.spaceapi;

let contract: ContractApp;

beforeAll(async () => {
  contract = await buildContractApp();
});

afterAll(async () => {
  await contract.close();
});

async function spaceApi(state: "open" | "closed", path: string = "/index.php") {
  contract.seedState(state);
  return contract.app.inject({ method: "GET", url: path });
}

describe("SpaceAPI document vs the legacy golden fixtures", () => {
  for (const state of ["closed", "open"] as const) {
    it(`is JSON-identical to the legacy document when the space is ${state}`, async () => {
      const response = await spaceApi(state);

      expect(response.statusCode).toBe(legacy.status);
      expect(response.json()).toEqual(JSON.parse(legacyBody("spaceapi", state)));
    });

    it(`differs from the legacy bytes only in key order and / escaping (${state})`, async () => {
      const response = await spaceApi(state);

      // Sorting keys cancels the one ordering difference and unescaping
      // cancels the other; anything else — a renamed field, a reformatted
      // float, a changed string — still fails here.
      expect(canonicalJson(response.rawPayload.toString("utf8"))).toBe(
        canonicalJson(unescapeSlashes(legacyBody("spaceapi", state))),
      );
    });

    it(`reports the live open flags in both places (${state})`, async () => {
      const document = (await spaceApi(state)).json();
      const expected = state === "open";

      // The legacy PHP set `open` and `state.open` from one variable; a
      // consumer reading either must see the same answer.
      expect(document.open).toBe(expected);
      expect(document.state.open).toBe(expected);
    });
  }

  it("serves the same document at every path that carries it", async () => {
    contract.seedState("open");
    const bodies = await Promise.all(
      SPACEAPI_PATHS.map(async (path) => {
        const response = await contract.app.inject({ method: "GET", url: path });
        expect(response.statusCode).toBe(200);
        return response.rawPayload.toString("utf8");
      }),
    );

    expect(new Set(bodies).size).toBe(1);
  });

  it("agrees with /spacestate.php about the state", async () => {
    contract.seedState("open");
    const document = (await contract.app.inject({ method: "GET", url: "/index.php" })).json();
    const simple = (await contract.app.inject({ method: "GET", url: "/spacestate.php" })).json();

    // In the legacy system this was true by construction: SpaceApiScripts
    // fetched spacestate.php to fill in its `open` flags. Here they are two
    // reads of one service, so it needs asserting.
    expect(document.open).toBe(simple.state === "open");
  });
});

describe("SpaceAPI response headers vs the legacy recording", () => {
  it("sends the CORS and caching headers the legacy endpoint sent", async () => {
    const response = await spaceApi("closed");

    expect(response.headers["access-control-allow-origin"]).toBe(
      legacy.headers?.["access-control-allow-origin"],
    );
    expect(response.headers["cache-control"]).toBe(legacy.headers?.["cache-control"]);
  });

  it("keeps the legacy media type, adding only the charset parameter", async () => {
    const response = await spaceApi("closed");

    expect(mediaType(response.headers["content-type"])).toBe(
      mediaType(legacy.headers?.["content-type"]),
    );
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
  });
});

describe("the documented byte differences", () => {
  // These two assertions exist so that test/contract/README.md cannot go
  // stale: if either difference disappears, the README entry for it is wrong
  // and this fails.
  it("still describes the legacy fixture accurately", () => {
    const raw = legacyBody("spaceapi", "closed");

    expect(raw).toContain(String.raw`"url":"https:\/\/pixelbar.nl"`);
    expect(Object.keys(JSON.parse(raw)).indexOf("open")).toBe(7);
    expect(raw.endsWith("\n")).toBe(false);
  });

  it("still describes this app's output accurately", async () => {
    const raw = (await spaceApi("closed")).rawPayload.toString("utf8");

    expect(raw).toContain('"url":"https://pixelbar.nl"');
    expect(Object.keys(JSON.parse(raw)).at(-1)).toBe("open");
    expect(raw.endsWith("\n")).toBe(false);
  });
});
