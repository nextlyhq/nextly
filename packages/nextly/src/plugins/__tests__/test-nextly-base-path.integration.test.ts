/**
 * Where a harness instance writes the files a Builder save generates.
 *
 * `registerServices` takes those paths from its `basePath` and falls back to
 * the working directory, which under a test runner is the package being
 * tested. An instance given no `basePath` therefore gets a temporary folder of
 * its own and removes it on `destroy()`, or when its boot fails; a folder the
 * caller gives is used as given and kept.
 *
 * The working directory is pointed at an empty folder here, so a write that
 * reaches it is seen, and `TMPDIR` at another, so the instance's own folder is
 * seen being made and removed.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import type { ServiceContainer } from "../../services";
import { definePlugin } from "../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../test-nextly";

/** Every file below `dir`; none when it does not exist. */
async function filesBelow(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .sort();
}

/**
 * A Builder collection create, as a development server runs it: the save
 * applies its DDL and writes its migration below the instance's `basePath`.
 */
async function builderCreate(name: string): Promise<void> {
  const previous = process.env.NODE_ENV;
  vi.stubEnv("NODE_ENV", "development");
  try {
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      {
        name,
        label: "Base path probe",
        fields: [{ name: "body", type: "text" }],
      }
    );
  } finally {
    vi.stubEnv("NODE_ENV", previous);
  }
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`createTestNextly's generated files — ${dialect}`, () => {
    let workingDir: string;
    let scratchTmp: string;
    let current: TestNextly | undefined;

    beforeEach(async () => {
      workingDir = await mkdtemp(join(tmpdir(), "nextly-cwd-"));
      scratchTmp = await mkdtemp(join(tmpdir(), "nextly-tmp-"));
      vi.spyOn(process, "cwd").mockReturnValue(workingDir);
      // `os.tmpdir()` reads it on every call, so the instance's folder is made here.
      vi.stubEnv("TMPDIR", scratchTmp);
    });

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(workingDir, { recursive: true, force: true });
      await rm(scratchTmp, { recursive: true, force: true });
    });

    it("writes a save's migration below a folder of its own, never the working directory, and removes it", async () => {
      const t = await createTestNextly({ dialect });
      current = t;
      await builderCreate("base-path-probe");
      expect(await t.adapter.tableExists("dc_base_path_probe")).toBe(true);

      expect(await filesBelow(workingDir)).toEqual([]);
      // The save did write a migration, into the config's migrations folder (the default
      // `./src/db/migrations`) below the instance's own, so the empty working directory is not
      // merely a save that wrote nothing; the old dynamic folder gets none.
      expect(
        await filesBelow(join(t.basePath, "src/db/migrations"))
      ).not.toEqual([]);
      expect(
        await filesBelow(join(t.basePath, "src/db/migrations/dynamic"))
      ).toEqual([]);
      expect(readdirSync(scratchTmp)).toHaveLength(1);

      await t.destroy();
      current = undefined;
      expect(existsSync(t.basePath)).toBe(false);
      expect(readdirSync(scratchTmp)).toEqual([]);
    }, 60_000);

    it("uses a folder the caller gives as given, and keeps it", async () => {
      const given = await mkdtemp(join(workingDir, "app-"));
      const t = await createTestNextly({ dialect, basePath: given });
      current = t;
      expect(t.basePath).toBe(given);
      await builderCreate("base-path-given");

      expect(await filesBelow(join(given, "src/db/migrations"))).not.toEqual(
        []
      );
      expect(readdirSync(scratchTmp)).toEqual([]);

      await t.destroy();
      current = undefined;
      expect(existsSync(given)).toBe(true);
    }, 60_000);

    it("removes its folder when the boot fails", async () => {
      // What the temporary directory held while the boot was running, so the
      // empty one afterwards is a removal rather than a folder never made.
      let duringBoot: string[] = [];
      const failing = definePlugin({
        name: "@test/fails-at-init",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init() {
          duringBoot = readdirSync(scratchTmp);
          throw new Error("init refused");
        },
      });

      await expect(
        createTestNextly({ dialect, plugins: [failing] })
      ).rejects.toThrow("init refused");
      expect(duringBoot).toHaveLength(1);
      expect(readdirSync(scratchTmp)).toEqual([]);
      expect(await filesBelow(workingDir)).toEqual([]);
    }, 60_000);
  });
}
