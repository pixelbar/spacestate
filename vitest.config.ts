import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration test files share the same Azurite tables and each resets
    // them in beforeAll — running files in parallel would race.
    fileParallelism: false,
  },
});
