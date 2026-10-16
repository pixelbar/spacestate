import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import type { ConfigSource } from "./types.js";

/**
 * Reads the space config from a blob in the app's own Storage Account via
 * the Container App's system-assigned managed identity — no connection
 * string/secret involved. The blob's content is edited out-of-band by an
 * operator; this class only ever reads.
 */
export class BlobConfigSource implements ConfigSource {
  private readonly blobClient;

  constructor(accountName: string, containerName: string, blobName: string) {
    const serviceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
    this.blobClient = serviceClient.getContainerClient(containerName).getBlobClient(blobName);
  }

  async load(): Promise<string> {
    const buffer = await this.blobClient.downloadToBuffer();
    return buffer.toString("utf8");
  }
}
