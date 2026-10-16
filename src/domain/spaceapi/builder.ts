import type { SpaceApiConfig } from "../../config/schema.js";
import type { CurrentStateSnapshot } from "../state/types.js";

export type SpaceApiDocument = SpaceApiConfig & {
  open: boolean;
  state: SpaceApiConfig["state"] & { open: boolean };
};

/**
 * Builds the SpaceAPI JSON document: the static config is served verbatim,
 * with only the live open/closed flags (top-level `open` and `state.open`)
 * filled in from current state.
 */
export function buildSpaceApiDocument(
  config: SpaceApiConfig,
  state: CurrentStateSnapshot,
): SpaceApiDocument {
  const isOpen = state.state === "open";
  return { ...config, open: isOpen, state: { ...config.state, open: isOpen } };
}
