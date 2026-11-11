/**
 * Next.js's own reader of the build output, loaded from the path nextly's
 * cache handler depends on, so a Next.js release that moves it fails here
 * rather than every new server process silently rendering its prebuilt pages
 * again.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildOutputReader } from "../build-output";

// The file system Next.js hands a cache handler as it constructs one, with
// the promise-returning reads its own reader awaits.
const { nodeFs: fs } = createRequire(import.meta.url)(
  "next/dist/server/lib/node-fs-methods.js"
) as { nodeFs: unknown };

describe("Next.js's own reader of the build output", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-build-output-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads from the path this depends on, and reads what the build wrote", async () => {
    // A route response as `next build` writes one: its body, and beside it
    // the status and headers. Only a reader that loaded can hand it back, so
    // a release that moves or reshapes the module fails here, not as a miss.
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "robots.txt.body"), "User-agent: *");
    writeFileSync(
      join(dir, "app", "robots.txt.meta"),
      JSON.stringify({ status: 200, headers: { "content-type": "text/plain" } })
    );
    const read = buildOutputReader({ fs, serverDistDir: dir });

    const entry = await read?.("/robots.txt", "APP_ROUTE", {
      kind: "APP_ROUTE",
    });

    expect(entry?.value).toMatchObject({
      kind: "APP_ROUTE",
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    expect(String((entry?.value as { body?: unknown }).body)).toBe(
      "User-agent: *"
    );
  });

  it("reads a page the build never wrote as a miss", async () => {
    const read = buildOutputReader({ fs, serverDistDir: dir });

    await expect(
      read?.("/nowhere", "APP_PAGE", { kind: "APP_PAGE" })
    ).resolves.toBeNull();
  });

  it("is nothing to read without a build directory, as in development", () => {
    expect(buildOutputReader({ fs })).toBeUndefined();
    expect(buildOutputReader(undefined)).toBeUndefined();
  });
});
