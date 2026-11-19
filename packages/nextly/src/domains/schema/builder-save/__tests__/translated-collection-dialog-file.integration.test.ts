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
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";

// The test's seams. The translations table's step after the file can be made to fail once; and a
// statement `fileFailure.matches` names is sent, in the file's run, as one the database refuses.
const seams = vi.hoisted(() => ({
  reconcileFails: false,
  fileFailure: undefined as RegExp | undefined,
}));
vi.mock("../../services/collection-schema-apply", async original => {
  const actual =
    await original<typeof import("../../services/collection-schema-apply")>();
  return {
    ...actual,
    reconcileCollectionCompanionAfterFile: async (
      ...args: Parameters<typeof actual.reconcileCollectionCompanionAfterFile>
    ) => {
      if (seams.reconcileFails) {
        seams.reconcileFails = false;
        throw new Error("the translations table's step failed");
      }
      return actual.reconcileCollectionCompanionAfterFile(...args);
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
          : statements.map(statement =>
              matches.test(statement)
                ? "SELECT injected_failure FROM injected_failure"
                : statement
            ),
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
      await t
        .getService("collectionService")
        .createCollection(
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
      const before = await row();
      seams.reconcileFails = true;

      const failed = await addTeaser().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(failed).toBeDefined();
      expect((await row()).version).toBe(before.version);
    });

    // A field leaving translation has its other languages' values archived before the file runs;
    // the push's questions come first, so a request refused for one leaves no archive rows.
    it("refuses an unconfirmed drop before archiving a field that leaves translation", async () => {
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
      // The archive holds nothing: the table is absent, or empty.
      const archived = await exec<{ n: number | string }>(
        "SELECT COUNT(*) AS n FROM nextly_i18n_archive"
      ).then(
        rows => Number(rows[0]?.n ?? 0),
        () => 0
      );
      expect(archived).toBe(0);
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

        const failed = await addTeaser().then(
          () => undefined,
          (error: unknown) => error
        );

        expect(failed).toBeDefined();
        expect(files()).toEqual(before.files);
        expect(await applied()).toEqual(before.applied);
        expect(await row()).toEqual(before.row);
      }
    );
  });
}
