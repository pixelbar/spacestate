import type { CurrentStateSnapshot } from "../state/types.js";
import type { JsonObject } from "./render.js";
import type { SpaceApiVersion } from "./versions.js";

/** The parsed `spaceapi.yaml`: each version's static document, ready to serve. */
export interface SpaceApiConfig {
  /** The `space` name, which every version shares (notifications use it). */
  space: string;
  documents: Record<SpaceApiVersion, JsonObject>;
}

export type SpaceApiDocument = JsonObject & { state: JsonObject & { open: boolean; lastchange?: number } };

/**
 * One version's document: the static config for that version plus the
 * fields the service owns — the version header (`api` before 14,
 * `api_compatibility` from 14), `state.open`, and `state.lastchange` once a
 * state has been recorded.
 */
export function buildSpaceApiDocument(
  config: SpaceApiConfig,
  version: SpaceApiVersion,
  snapshot: Pick<CurrentStateSnapshot, "state" | "changedAt">,
): SpaceApiDocument {
  const { state, ...rest } = config.documents[version];
  const header = version.startsWith("0.") ? { api: version } : { api_compatibility: [version] };
  const lastchange = Math.floor(Date.parse(snapshot.changedAt) / 1000);
  return {
    ...header,
    ...rest,
    state: {
      ...(state as JsonObject | undefined),
      open: snapshot.state === "open",
      // The service's default before anything was recorded is the epoch,
      // which would claim a change in 1970.
      ...(lastchange > 0 ? { lastchange } : {}),
    },
  };
}
