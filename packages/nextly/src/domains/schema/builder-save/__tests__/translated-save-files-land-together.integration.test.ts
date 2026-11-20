/**
 * A Builder save of a translated collection writes a migration file and the
 * file of its translations table. Where the second cannot be written, the
 * first is not left in the folder without it: a save that found the migration
 * there would read the change as written, and never write the missing file.
 * The save fails with the folder as it was, and the same save made again
 * writes both, on every dialect.
 *
 * The save has two things keeping this: its files are prepared aside and put
 * in place together, and a save that fails removes the files it added. This
 * holds the outcome, whichever of the two a change takes away.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../../../collections/services/collection-service";

// The test's seam on the translations file a save writes: while `fails` is
// set, the file cannot be written, as on a disk with no room left.
const companionWrite = vi.hoisted(() => ({ fails: false, asked: 0 }));
vi.mock("../../../i18n/migration/write-migration-file", async original => {
  const actual =
    await original<
      typeof import("../../../i18n/migration/write-migration-file")
    >();
  return {
    ...actual,
    prepareCompanionMigrationFile: (
      ...args: Parameters<typeof actual.prepareCompanionMigrationFile>
    ) => {
      companionWrite.asked += 1;
      if (companionWrite.fails)
        throw Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
        });
      return actual.prepareCompanionMigrationFile(...args);
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

const posts = {
  name: "posts",
  label: "Post",
  localized: true,
  fields: [
    { name: "heading", type: "text", localized: true },
    { name: "views", type: "number" },
  ],
} as Parameters<CollectionService["createCollection"]>[0];

describe.each(getConfiguredTestDialects())(
  "a translated collection's save, where its translations file cannot be written (%s)",
  dialect => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-files-together-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
    });

    afterEach(async () => {
      companionWrite.fails = false;
      companionWrite.asked = 0;
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    /** Every migration file, snapshot and file still waiting aside, by its path in the folder. */
    const inFolder = () => {
      const dir = join(basePath, "migrations");
      return existsSync(dir)
        ? (readdirSync(dir, { recursive: true }) as string[])
            .filter(name => /\.(sql|json|tmp)$/.test(name))
            .sort()
        : [];
    };

    it("leaves no migration behind without it, and the save made again writes both", async () => {
      const service = t.getService("collectionService");
      const before = inFolder();
      companionWrite.fails = true;

      const failed = await service.createCollection(posts, {}).then(
        () => undefined,
        (error: unknown) => error
      );

      // The control: the save reached the translations file, and failed there.
      expect(companionWrite.asked).toBeGreaterThan(0);
      expect(failed).toBeDefined();
      expect(inFolder()).toEqual(before);

      companionWrite.fails = false;
      await service.createCollection(posts, {});

      const written = inFolder().filter(name => !before.includes(name));
      const files = written.filter(name => name.endsWith(".sql"));
      expect(files.some(name => name.endsWith("_localization_posts.sql"))).toBe(
        true
      );
      expect(files.length, files.join(", ")).toBeGreaterThanOrEqual(2);
      expect(written.filter(name => name.endsWith(".tmp"))).toEqual([]);
      // And the collection works in both languages.
      await t.nextly.create({
        collection: "posts",
        locale: "en",
        data: { heading: "Hello", views: 1 },
      });
      const read = await t.nextly.find({ collection: "posts", locale: "en" });
      expect((read.items[0] as { heading?: string }).heading).toBe("Hello");
    }, 120_000);
  }
);
