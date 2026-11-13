/**
 * The recorder reuses an installed release site only when it was made from the
 * release being recorded, so a baseline is never built by another release
 * while `meta.json` names this one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isInstalledFrom } from "./record";

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
