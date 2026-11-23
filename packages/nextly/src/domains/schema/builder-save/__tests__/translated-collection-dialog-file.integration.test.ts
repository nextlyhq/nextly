/**
 * A translated collection's schema dialog save that carries no values runs the migration file it
 * writes, as a Single's and a field group's do, rather than its push:
 *
 * - the push never runs, and the save's files are recorded applied;
 * - the dialog's write of the registry row, which advances its schema version, comes after the
 *   translations table is brought in step with the file, so a failure of that step leaves the
 *   version as it was rather than recording a change the translations table does not hold;
 * - on SQLite and PostgreSQL the save's files run in one transaction, so a failure of its
 *   translations file takes its own file back with it, and nothing of the save is left.
 *
 * Run as a development server runs it, where a Builder save applies at once.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";

// The test's seams. The translations table's step after the file can be made to fail once; and a
// statement `fileFailure.matches` names is sent, in the file's run, as one the database refuses.
const seams = vi.hoisted(() => ({
  reconcileFails: false,
  fileFailure: undefined as RegExp | undefined,
  /** How many statements `fileFailure` matched and replaced, so a case can see it was reached. */
  fileFailureHits: 0,
}));
// The step after the file is the road's `after` (`collectionFileRoad`), which the dialog takes
// from this module, so it is wrapped there.
vi.mock("../../services/collection-schema-apply", async original => {
  const actual =
    await original<typeof import("../../services/collection-schema-apply")>();
  return {
    ...actual,
    collectionFileRoad: (
      ...args: Parameters<typeof actual.collectionFileRoad>
    ) => {
      const road = actual.collectionFileRoad(...args);
      return {
        ...road,
        after: async () => {
          if (seams.reconcileFails) {
            seams.reconcileFails = false;
            throw new Error("the translations table's step failed");
          }
          return road.after();
        },
      };
    },
  };
});
vi.mock("../../busy-table/run-unit", async original => {
  const actual = await original<typeof import("../../busy-table/run-unit")>();
  return {
    ...actual,
    runUnitInTries: (
      ...[adapter, statements, ...rest]: Parameters<
        typeof actual.runUnitInTries
      >
    ) => {
      const matches = seams.fileFailure;
      return actual.runUnitInTries(
        adapter,
        matches === undefined
          ? statements
          : statements.map(statement => {
              if (!matches.test(statement)) return statement;
              seams.fileFailureHits += 1;
              return "SELECT injected_failure FROM injected_failure";
            }),
        ...rest
      );
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const HEADING = { name: "heading", type: "text" };
const TEASER = { name: "teaser", type: "text" };

for (const dialect of getConfiguredTestDialects()) {
  describe(`a translated collection's dialog save (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-translated-dialog-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      await t.getService("collectionService").createCollection(
        {
          name: "posts",
          label: "Post",
          localized: true,
          fields: [HEADING],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
    });

    afterEach(async () => {
      seams.reconcileFails = false;
      seams.fileFailure = undefined;
      vi.restoreAllMocks();
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const adapterOf = () => t.adapter as unknown as DrizzleAdapter;
    const exec = <R>(statement: string) =>
      (
        t.adapter as unknown as {
          executeQuery<T>(sql: string): Promise<T[]>;
        }
      ).executeQuery<R>(statement);
    const companionColumns = async () =>
      (
        await readTableDefinition(
          statement => exec(statement),
          adapterOf().getCapabilities().dialect,
          "dc_posts_locales"
        )
      ).columns.map(column => column.name);
    const files = () => {
      const dir = join(basePath, "migrations");
      return existsSync(dir)
        ? readdirSync(dir)
            .filter(name => name.endsWith(".sql"))
            .sort()
        : [];
    };
    const applied = async () =>
      (
        await new SchemaEventsRepository(
          adapterOf().getDrizzle() as never,
          adapterOf().getCapabilities().dialect
        ).listFileApplies()
      )
        .filter(entry => entry.status === "applied")
        .map(entry => entry.filename)
        .sort();
    const row = async () => {
      const [stored] = await exec<{
        version: number | string | null;
        fields: unknown;
      }>(
        "SELECT schema_version AS version, fields FROM dynamic_collections WHERE slug = 'posts'"
      );
      return {
        version: Number(stored?.version ?? 1),
        fields:
          typeof stored?.fields === "string"
            ? stored.fields
            : JSON.stringify(stored?.fields),
      };
    };
    // A translated field added to the translated collection: its column joins the translations
    // table, a change that carries no values, written as the collection's file and its
    // translations table's.
    const addTeaser = async () =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [HEADING, TEASER],
          confirmed: true,
          localized: true,
          schemaVersion: (await row()).version,
        }
      );

    it("runs its migration file rather than its push, and records it applied", async () => {
      const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");
      const before = files();

      await addTeaser();

      expect(pushed).not.toHaveBeenCalled();
      const written = files().filter(name => !before.includes(name));
      expect(written.length).toBeGreaterThan(0);
      expect(await applied()).toEqual(expect.arrayContaining(written));
    });

    // The file records the change's fields in its own transaction; the dialog's write of the row,
    // which advances its schema version, comes after the translations table's step, so a failure
    // of that step leaves the version where it was.
    it("leaves the registry row's version as it was when the translations table's step after the file fails", async () => {
      const before = { row: await row(), files: files() };
      seams.reconcileFails = true;

      const failed = await addTeaser().then(
        () => undefined,
        (error: unknown) => error
      );

      // The save reached the step after its file: the seam's own failure, with the files the save
      // wrote recorded applied, not a refusal before any file ran.
      expect(String(failed)).toMatch(/the translations table's step failed/);
      const written = files().filter(name => !before.files.includes(name));
      expect(written.length).toBeGreaterThan(0);
      expect(await applied()).toEqual(expect.arrayContaining(written));
      expect((await row()).version).toBe(before.row.version);
    });

    // `teaser` added translated, and an entry holding a value in each language.
    const seedTeaser = async () => {
      const handler = t.getService("collectionsHandler") as unknown as {
        getEntryService(): {
          createEntry(
            options: Record<string, unknown>,
            data: Record<string, unknown>
          ): Promise<{ success: boolean; data?: unknown }>;
          updateEntry(
            options: Record<string, unknown>,
            data: Record<string, unknown>
          ): Promise<{ success: boolean }>;
        };
      };
      await addTeaser();
      const entries = handler.getEntryService();
      const created = await entries.createEntry(
        { collectionName: "posts", overrideAccess: true, locale: "en" },
        { heading: "Hello", teaser: "Hi" }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = String((created.data as { id: unknown }).id);
      const translated = await entries.updateEntry(
        {
          collectionName: "posts",
          entryId: id,
          overrideAccess: true,
          locale: "es",
        },
        { heading: "Hola", teaser: "Buenas", _overwrite: true }
      );
      expect(translated.success, JSON.stringify(translated)).toBe(true);
    };
    // The rows the archive holds, or none where its table is absent: its absence is read, and any
    // other failure fails the test rather than reading as an empty archive.
    const archivedRows = async () => {
      const present =
        adapterOf().getCapabilities().dialect === "sqlite"
          ? "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nextly_i18n_archive'"
          : adapterOf().getCapabilities().dialect === "postgresql"
            ? "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'nextly_i18n_archive'"
            : "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'nextly_i18n_archive'";
      if ((await exec(present)).length === 0) return 0;
      const [counted] = await exec<{ n: number | string }>(
        "SELECT COUNT(*) AS n FROM nextly_i18n_archive"
      );
      return Number(counted?.n ?? 0);
    };
    // A field leaving translation has its other languages' values archived before the file runs;
    // the push's questions come first, so a request refused for one leaves no archive rows.
    it("refuses an unconfirmed drop before archiving a field that leaves translation", async () => {
      await seedTeaser();
      const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");

      // `teaser` leaves translation, and `heading`, translated and holding values, is removed
      // without a confirmation.
      const refused = await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [{ ...TEASER, localized: false }],
          confirmed: true,
          localized: true,
          schemaVersion: (await row()).version,
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(pushed).not.toHaveBeenCalled();
      expect(String(refused)).toMatch(/cancelled/);
      expect(await archivedRows()).toBe(0);
    });

    // The writer's own checks before its first write (its history, its plan, the translations
    // table's drift) come before the archive too: a save they refuse has archived nothing.
    it("writes no archive row when the writer's own checks refuse the save", async () => {
      await seedTeaser();
      // A column added to the translations table by hand, which the migration history does not
      // record: the writer refuses the save as drift before its first write.
      await exec("ALTER TABLE dc_posts_locales ADD COLUMN stray TEXT");

      const refused = await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [HEADING, { ...TEASER, localized: false }],
          confirmed: true,
          localized: true,
          schemaVersion: (await row()).version,
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(
        `${refused instanceof Error ? refused.message : String(refused)}`
      ).toMatch(/schema drift detected/);
      expect(await archivedRows()).toBe(0);
    });

    it.skipIf(dialect === "mysql")(
      "leaves nothing of the save when its translations file fails after its own file",
      async () => {
        const before = {
          files: files(),
          applied: await applied(),
          row: await row(),
        };
        seams.fileFailure =
          /dc_posts_locales[`"]?\s.*ADD (COLUMN )?[`"]teaser[`"]/;
        seams.fileFailureHits = 0;

        const failed = await addTeaser().then(
          () => undefined,
          (error: unknown) => error
        );

        // The runner reached the translations file's ADD statement and the database refused it.
        expect(seams.fileFailureHits).toBe(1);
        expect(JSON.stringify(failed) + String(failed)).toMatch(
          /injected_failure/
        );
        expect(files()).toEqual(before.files);
        expect(await applied()).toEqual(before.applied);
        expect(await row()).toEqual(before.row);
        // Taken back in the database too: the translations table has no `teaser`.
        expect(await companionColumns()).not.toContain("teaser");

        // The same check sees `teaser` once the save commits.
        seams.fileFailure = undefined;
        await addTeaser();
        expect(await companionColumns()).toContain("teaser");
      }
    );
  });
}
