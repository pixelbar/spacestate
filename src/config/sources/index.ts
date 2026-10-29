import { FileConfigSource } from "./fileSource.js";
import { BlobConfigSource } from "./blobSource.js";
import type { ConfigSource, WritableConfigSource } from "./types.js";

export type { ConfigSource, WritableConfigSource } from "./types.js";

/**
 * CONFIG_SOURCE selects where the config document is loaded from:
 *   - file://./config/spaceapi.sample.json  (local dev, tests)
 *   - blob://<account>/<container>/<blob>  (production, via managed identity)
 */
export function createConfigSource(configSourceUrl: string): WritableConfigSource {
  if (configSourceUrl.startsWith("file://")) {
    return new FileConfigSource(configSourceUrl.slice("file://".length));
  }

  if (configSourceUrl.startsWith("blob://")) {
    const withoutScheme = configSourceUrl.slice("blob://".length);
    const [accountName, containerName, ...blobParts] = withoutScheme.split("/");
    if (!accountName || !containerName || blobParts.length === 0) {
      throw new Error(`Invalid blob config source URL: ${configSourceUrl}`);
    }
    return new BlobConfigSource(accountName, containerName, blobParts.join("/"));
  }

  throw new Error(`Unsupported config source scheme: ${configSourceUrl}`);
}
