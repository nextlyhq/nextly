/**
 * A scaffold that installs the form builder installs its peer
 * `@nextlyhq/plugin-sdk` too. npm, pnpm and Bun add a missing peer on their
 * own; Yarn does not, so under Plug'n'Play the plugin could not load the SDK
 * and the app's config failed to load ("tried to access @nextlyhq/plugin-sdk
 * (a peer dependency) but it isn't provided by your application").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseConfig } from "../types";
import { generatePackageJson } from "../utils/template";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};
const ALPHA = "0.0.2-alpha.42";

describe("plugin peers in the scaffold's package.json", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ latest: ALPHA, alpha: ALPHA }),
      }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declares @nextlyhq/plugin-sdk beside the form builder, on the same release", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blog-app", sqlite, false, "blog")
    );

    expect(pkg.dependencies["@nextlyhq/plugin-form-builder"]).toBe(`^${ALPHA}`);
    expect(pkg.dependencies["@nextlyhq/plugin-sdk"]).toBe(
      pkg.dependencies["@nextlyhq/plugin-form-builder"]
    );
  });

  it("leaves both out of a scaffold without the form builder", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("blank-app", sqlite, false, "blank")
    );

    expect(pkg.dependencies["@nextlyhq/plugin-form-builder"]).toBeUndefined();
    expect(pkg.dependencies["@nextlyhq/plugin-sdk"]).toBeUndefined();
  });
});
