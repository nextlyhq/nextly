/**
 * A deploy builds with the project's `build` script, often with `NODE_ENV`
 * unset while it runs. The CLI picks its environment files from `--mode`, or
 * from `NODE_ENV` when no mode is given, so a CLI step without the flag would
 * read `.env.development` and migrate the development database, while the
 * `next build` after it reads `.env.production`. Every `nextly` step a
 * scaffold's build runs therefore carries `--mode production`.
 *
 * Every template config's build is checked beside the plugin installs, in
 * `build-installs-configured-plugins.test.ts`, so both read the same configs.
 * This file holds the builds no template config decides.
 */
import { describe, expect, it } from "vitest";

import type { DatabaseConfig } from "../types";
import { generatePackageJson } from "../utils/template";

const MODE = "--mode production";

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

describe("a scaffold's build outside the template configs", () => {
  it("writes the plain build for a project with no template directory", async () => {
    const pkg = JSON.parse(await generatePackageJson("app", sqlite));
    expect(pkg.scripts.build).toBe(`nextly migrate ${MODE} && next build`);
  });

  it("leaves the commands run by hand to follow NODE_ENV, as they do today", async () => {
    const pkg = JSON.parse(await generatePackageJson("app", sqlite));
    expect(pkg.scripts["db:migrate"]).toBe("nextly migrate");
    expect(pkg.scripts.dev).toBe("next dev --turbopack");
  });

  it("gives a Plugin's build no CLI step: a plugin is a library, built with tsdown and never deployed", async () => {
    const pkg = JSON.parse(
      await generatePackageJson("my-plugin", sqlite, true, "plugin")
    );
    expect(pkg.scripts.build).toBe("tsdown");
  });
});
