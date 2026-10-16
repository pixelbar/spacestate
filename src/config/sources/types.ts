export interface ConfigSource {
  load(): Promise<string>;
}
