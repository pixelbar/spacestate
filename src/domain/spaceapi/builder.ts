import type { SpaceConfig } from "../../config/schema.js";
import type { CurrentStateSnapshot } from "../state/types.js";

const SPACEAPI_VERSION = "0.13";

interface SpaceApiContact {
  email: string;
  irc?: string;
  ml?: string;
  twitter?: string;
  discord?: string;
  mastodon?: string;
  keymasters?: SpaceConfig["space"]["keymasters"];
}

export interface SpaceApiDocument {
  api: string;
  space: string;
  logo: string;
  url: string;
  location: { address: string; lon: number; lat: number };
  contact: SpaceApiContact;
  spacefed: { spacenet: boolean; spacesaml: boolean; spacephone: boolean };
  open: boolean;
  icon: { open: string; closed: string };
  state: { open: boolean; icon: { open: string; closed: string }; lastchange: number };
  issue_report_channels: string[];
  projects: string[];
}

/** Builds the SpaceAPI v0.13 JSON document from static config + live state. */
export function buildSpaceApiDocument(
  config: SpaceConfig,
  state: CurrentStateSnapshot,
): SpaceApiDocument {
  const { space } = config;

  const contact: SpaceApiContact = { email: space.contact.email };
  if (space.contact.irc) contact.irc = space.contact.irc;
  if (space.contact.ml) contact.ml = space.contact.ml;
  if (space.contact.twitter) contact.twitter = space.contact.twitter;
  if (space.contact.discord) contact.discord = space.contact.discord;
  if (space.contact.mastodon) contact.mastodon = space.contact.mastodon;
  if (space.keymasters.length > 0) contact.keymasters = space.keymasters;

  const isOpen = state.state === "open";
  const icon = { open: space.logo, closed: space.logo };

  return {
    api: SPACEAPI_VERSION,
    space: space.name,
    logo: space.logo,
    url: space.url,
    location: { address: space.address, lon: space.location.lon, lat: space.location.lat },
    contact,
    spacefed: space.spacefed,
    open: isOpen,
    icon,
    // `icon` is duplicated here (top-level, for older clients, and nested
    // under `state`, for 0.12+ clients) to match the real SpaceAPI document
    // — confirmed by running the actual legacy SpaceApiScripts locally.
    state: { open: isOpen, icon, lastchange: Math.floor(new Date(state.changedAt).getTime() / 1000) },
    issue_report_channels: ["email"],
    projects: space.github ? [space.github] : [],
  };
}
