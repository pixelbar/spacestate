import { readFile } from "node:fs/promises";
import type { ConfigSource } from "./types.js";

export class FileConfigSource implements ConfigSource {
  constructor(private readonly path: string) {}

  async load(): Promise<string> {
    return readFile(this.path, "utf8");
  }
}
