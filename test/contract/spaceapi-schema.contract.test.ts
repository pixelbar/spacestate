import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateSpaceApiDocument } from "../../src/domain/spaceapi/validate.js";
import {
  LATEST_SPACEAPI_VERSION,
  SPACEAPI_VERSIONS,
  spaceApiVersionSlug,
  type SpaceApiVersion,
} from "../../src/domain/spaceapi/versions.js";
import { buildContractApp, type ContractApp } from "../helpers/buildContractApp.js";
import { mediaType } from "./legacyParity.js";

/**
 * Every address that serves a SpaceAPI document, in both states, holds to
 * the official schema of the version it claims. See README.md, "SpaceAPI
 * schema contract".
 */

const ADDRESSES: { path: string; version: SpaceApiVersion }[] = [
  // The default addresses: `/` is what the SpaceAPI directory lists.
  { path: "/", version: LATEST_SPACEAPI_VERSION },
  { path: "/index.php", version: LATEST_SPACEAPI_VERSION },
  { path: "/api/v1/spaceapi", version: LATEST_SPACEAPI_VERSION },
  { path: "/api/v1/spaceapi/0.13", version: "0.13" },
  ...SPACEAPI_VERSIONS.flatMap((version) => [
    { path: `/api/v1/spaceapi/${spaceApiVersionSlug(version)}`, version },
    { path: `/spaceapi/${spaceApiVersionSlug(version)}.json`, version },
  ]),
];

let contract: ContractApp;

beforeAll(async () => {
  contract = await buildContractApp();
});

afterAll(async () => {
  await contract.close();
});

async function get(path: string, state: "open" | "closed" = "closed") {
  contract.seedState(state);
  return contract.app.inject({ method: "GET", url: path });
}

describe("SpaceAPI documents vs the official schemas", () => {
  for (const { path, version } of ADDRESSES) {
    for (const state of ["closed", "open"] as const) {
      it(`${path} is a valid SpaceAPI ${version} document when ${state}`, async () => {
        const response = await get(path, state);
        expect(response.statusCode).toBe(200);
        const document = response.json();

        expect(validateSpaceApiDocument(version, document, "official")).toEqual([]);
        expect(validateSpaceApiDocument(version, document, "strict")).toEqual([]);
        if (version.startsWith("0.")) expect(document.api).toBe(version);
        else expect(document.api_compatibility).toEqual([version]);
        expect(document.state.open).toBe(state === "open");
        expect(document.state.lastchange).toBe(Date.parse(contract.changedAt) / 1000);
      });
    }

    it(`${path} sends the headers the SpaceAPI directory asks for`, async () => {
      const response = await get(path);
      expect(mediaType(response.headers["content-type"])).toBe("application/json");
      expect(response.headers["content-type"]).toMatch(/charset=utf-8/i);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.headers["cache-control"]).toBe("no-cache");
    });
  }

  it("serves the same document at every default address", async () => {
    const latest = (await get(`/api/v1/spaceapi/${spaceApiVersionSlug(LATEST_SPACEAPI_VERSION)}`)).json();
    for (const path of ["/", "/index.php", "/api/v1/spaceapi"]) {
      expect((await get(path)).json()).toEqual(latest);
    }
  });

  it.each(["/api/v1/spaceapi/16", "/api/v1/spaceapi/0.14", "/api/v1/spaceapi/latest", "/spaceapi/15", "/spaceapi/15.yaml"])(
    "%s is not found",
    async (path) => {
      expect((await get(path)).statusCode).toBe(404);
    },
  );
});
