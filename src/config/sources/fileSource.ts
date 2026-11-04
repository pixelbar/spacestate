import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ConfigConflictError, type VersionedDocument, type WritableConfigSource } from "./types.js";

export class FileConfigSource implements WritableConfigSource {
  constructor(private readonly path: string) {}

  async load(): Promise<string> {
    return readFile(this.path, "utf8");
  }

  async loadVersioned(): Promise<VersionedDocument> {
    try {
      const [text, info] = await Promise.all([readFile(this.path, "utf8"), stat(this.path)]);
      return { text, version: String(info.mtimeMs) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { text: undefined, version: undefined };
      throw err;
    }
  }

  async save(text: string, expectedVersion: string | undefined): Promise<void> {
    // Local development and tests only (single process), so a check-then-write
    // is enough; the blob source is where the real conditional write lives.
    const current = await this.loadVersioned();
    if (current.version !== expectedVersion) throw new ConfigConflictError();
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, this.path);
  }
}
