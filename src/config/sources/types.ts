export interface ConfigSource {
  load(): Promise<string>;
}

/** A document read together with an opaque version, for optimistic concurrency on write. */
export interface VersionedDocument {
  /** Undefined when the document does not exist yet. */
  text: string | undefined;
  version: string | undefined;
}

/** Thrown by `save` when the document changed since it was read. */
export class ConfigConflictError extends Error {
  constructor() {
    super("Config document changed since it was read");
  }
}

/**
 * A config document the app itself edits (the webhook registry). `save`
 * only succeeds if the document is still at `version` — otherwise it throws
 * ConfigConflictError so the caller can re-read and retry, instead of one
 * replica silently overwriting another's registration.
 */
export interface WritableConfigSource extends ConfigSource {
  loadVersioned(): Promise<VersionedDocument>;
  save(text: string, expectedVersion: string | undefined): Promise<void>;
}
