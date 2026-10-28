import { BlobServiceClient, type BlobClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { ConfigConflictError, type VersionedDocument, type WritableConfigSource } from "./types.js";

/**
 * Reads (and, for documents the app edits itself, writes) a config blob in
 * the app's own Storage Account via the Container App's system-assigned
 * managed identity — no connection string/secret involved. Most blobs are
 * edited out-of-band by an operator and only ever read; `save` is used by the
 * webhook registry, whose container is the only one the identity can write.
 */
export class BlobConfigSource implements WritableConfigSource {
  private readonly blobClient: BlobClient;

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

  async loadVersioned(): Promise<VersionedDocument> {
    try {
      const response = await this.blobClient.download();
      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody as AsyncIterable<Buffer>) chunks.push(chunk);
      return { text: Buffer.concat(chunks).toString("utf8"), version: response.etag };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return { text: undefined, version: undefined };
      throw err;
    }
  }

  async save(text: string, expectedVersion: string | undefined): Promise<void> {
    const body = Buffer.from(text, "utf8");
    try {
      await this.blobClient.getBlockBlobClient().upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: "application/yaml" },
        // If-Match <etag> to replace what we read; If-None-Match * to create
        // only if nobody else got there first.
        conditions: expectedVersion ? { ifMatch: expectedVersion } : { ifNoneMatch: "*" },
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 409 || status === 412) throw new ConfigConflictError();
      throw err;
    }
  }
}
