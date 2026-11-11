/**
 * Next.js's own reader of the build output, loaded from the path nextly's
 * cache handler depends on, so a Next.js release that moves it fails here
 * rather than every new server process silently rendering its prebuilt pages
 * again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildOutputReader } from "../build-output";

describe("Next.js's own reader of the build output", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-build-output-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads from the path this depends on, and reads a missing page as a miss", async () => {
    const read = buildOutputReader({ fs, serverDistDir: dir });
    expect(read).toBeTypeOf("function");

    await expect(
      read?.("/__route_cache__/nowhere", "APP_PAGE", { kind: "APP_PAGE" })
    ).resolves.toBeNull();
  });

  it("is nothing to read without a build directory, as in development", () => {
    expect(buildOutputReader({ fs })).toBeUndefined();
    expect(buildOutputReader(undefined)).toBeUndefined();
  });
});
