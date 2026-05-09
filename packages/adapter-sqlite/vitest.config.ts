// Unit test config for adapter-sqlite.
// Why explicit config: F18 splits tests into unit (*.test.ts excluding
// .integration.test.ts) and integration (*.integration.test.ts only).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.integration.test.ts"],
  },
});
