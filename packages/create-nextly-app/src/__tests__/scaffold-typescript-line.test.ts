/**
 * Scaffolds stay on TypeScript 5. A TypeScript 7 app type-checks and builds,
 * but `typescript-eslint` does not support 7.0 yet: the app's `npm run lint`
 * crashes ("typescript-eslint does not support TS 7.0"), and the plugin
 * scaffold's install fails, since `typescript-eslint` ^8 peers
 * `typescript <6.1`. Move this with the scaffold once `typescript-eslint`
 * supports 7 (typescript-eslint/typescript-eslint#10940).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

describe("the TypeScript a scaffold installs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each(["blank", "plugin"] as const)(
    "is TypeScript 5 for a %s project",
    async projectType => {
      // No registry: the TypeScript line is not something it decides.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("fetch failed");
        })
      );
      const { generatePackageJson } = await import("../utils/template");
      const pkg = JSON.parse(
        await generatePackageJson(
          `${projectType}-app`,
          sqlite,
          undefined,
          projectType
        )
      );
      expect(pkg.devDependencies.typescript).toBe("^5");
    }
  );
});
