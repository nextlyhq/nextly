/**
 * The recorder reuses an installed release site only when it was made from the
 * release being recorded, so a baseline is never built by another release
 * while `meta.json` names this one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isInstalledFrom, siteEnvironment } from "./record";

describe("isInstalledFrom", () => {
  let site: string;

  beforeEach(() => {
    site = mkdtempSync(join(tmpdir(), "upgrade-gate-site-"));
    mkdirSync(join(site, "apps/playground/node_modules/.bin"), {
      recursive: true,
    });
    writeFileSync(join(site, "apps/playground/node_modules/.bin/nextly"), "");
  });

  afterEach(() => {
    rmSync(site, { recursive: true, force: true });
  });

  it("reuses a finished install of the same release", () => {
    writeFileSync(join(site, ".release-commit"), "aaa\n");
    expect(isInstalledFrom(site, "aaa")).toBe(true);
  });

  it("makes the site again for another release", () => {
    writeFileSync(join(site, ".release-commit"), "aaa\n");
    expect(isInstalledFrom(site, "bbb")).toBe(false);
  });

  it("makes the site again when no install finished", () => {
    expect(isInstalledFrom(site, "aaa")).toBe(false);
  });
});

describe("siteEnvironment", () => {
  it("runs the playground as a site does: no browser-suite switches, the recorded plugins, this database", () => {
    const environment = siteEnvironment(
      {
        PATH: "/bin",
        DB_DIALECT: "postgresql",
        NEXTLY_E2E_STYLE_FIXTURE: "1",
        NEXTLY_E2E_DEV_RELOAD: "1",
        NEXTLY_SPEED_EXTRA_COLLECTIONS: "40",
        NEXTLY_PLAYGROUND_PLUGINS: "seo",
      },
      { databaseUrl: "file:/tmp/site.sqlite", playgroundPlugins: "" }
    );
    expect(environment).toEqual({
      PATH: "/bin",
      NODE_ENV: "development",
      DATABASE_URL: "file:/tmp/site.sqlite",
      NEXTLY_PLAYGROUND_PLUGINS: "",
    });
  });
});
