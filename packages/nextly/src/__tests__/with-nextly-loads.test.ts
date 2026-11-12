/**
 * What loading `nextly/next` costs. Next.js imports it with every load of
 * `next.config` (`next dev`, `next build`, `next start`, and sometimes more
 * than one process each), so the entry must not bring the core schema with
 * it: that alone adds most of a second to each load. `withNextly` loads the
 * migration runner's folder reading, which does bring it, only for a folder
 * holding a file an earlier Schema Builder wrote, the one case it decides.
 *
 * Judged on the BUILT entry, resolved through this package's exports as an
 * app's config resolves it, in a process of its own: a load hook records
 * every module Node loads, by URL, so nothing the entry reaches is missed.
 * The control: the same hook does see the core schema once the runner's
 * reading is loaded, so its absence elsewhere is not the hook seeing nothing.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/** Every module Node loaded, before and after `withNextly` ran on `dir`. */
interface Loads {
  imported: string[];
  afterWithNextly: string[];
  version: string | null;
}

/** Imports `nextly/next` in a fresh process, then runs `withNextly` on `dir`. */
function loadsOf(dir: string): Loads {
  const script = `
    import { registerHooks } from "node:module";
    const loaded = [];
    registerHooks({
      load(url, context, nextLoad) {
        loaded.push(url);
        return nextLoad(url, context);
      },
    });
    const { withNextly } = await import("nextly/next");
    const imported = [...loaded];
    const config = withNextly({}, {
      migrationsDir: process.env.SVL_DIR,
      dialect: "postgresql",
    });
    process.stdout.write(JSON.stringify({
      imported,
      afterWithNextly: loaded.slice(imported.length),
      version: config.env?.NEXTLY_BUILD_SCHEMA_VERSION ?? null,
    }));
  `;
  const run = spawnSync(
    process.execPath,
    ["--input-type=module", "--no-warnings", "-e", script],
    {
      cwd: resolve(import.meta.dirname, "../.."),
      env: { ...process.env, SVL_DIR: dir, NEXTLY_BUILD_SCHEMA_VERSION: "" },
      encoding: "utf8",
    }
  );
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout) as Loads;
}

/** Whether any loaded module is the core schema's. */
const coreSchema = (urls: readonly string[]): boolean =>
  urls.some(url => /\/core-schema[-.]/.test(url));

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("loading nextly/next", () => {
  it("loads no core schema, importing the entry or naming a folder's newest migration", () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-next-loads-"));
    writeFileSync(join(dir, "20260101_000000_000_init.sql"), "-- UP\n");

    const loads = loadsOf(dir);
    expect(loads.version).toBe("20260101_000000_000_init");
    expect(coreSchema(loads.imported)).toBe(false);
    expect(coreSchema(loads.afterWithNextly)).toBe(false);
  });

  it("loads the runner's reading for a folder holding a file an earlier Builder wrote, which it sets aside", () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-next-loads-"));
    writeFileSync(join(dir, "0001_000000_init.sql"), "-- UP\n");
    writeFileSync(
      join(dir, "1730000000000_create_pages.sql"),
      'CREATE TABLE "dc_pages" ("id" text PRIMARY KEY);'
    );

    const loads = loadsOf(dir);
    expect(loads.version).toBe("0001_000000_init");
    expect(coreSchema(loads.imported)).toBe(false);
    // The control: the hook sees the core schema when it does load.
    expect(coreSchema(loads.afterWithNextly)).toBe(true);
  });
});
