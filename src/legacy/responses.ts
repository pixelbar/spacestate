import type { SpaceState } from "../domain/state/types.js";

export const LEGACY_SUCCESS = "SUCCESS";
// Legacy typo, preserved byte-for-byte — some consumer may match on this
// exact string.
export const LEGACY_ALREADY_TOGGLED = "ALLREADY TOGGLED TO THIS STATE";
export const LEGACY_REDIRECT_URL = "https://www.pixelbar.nl/";

export function legacySpaceStateBody(state: SpaceState): { state: SpaceState } {
  return { state };
}
