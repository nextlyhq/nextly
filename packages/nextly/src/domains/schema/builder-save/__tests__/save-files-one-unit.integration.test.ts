/**
 * A Builder save written as several migration files, and how a later file's failure is left.
 *
 * - On MySQL, which commits each schema statement as it runs, the files run one by one: a later
 *   file's failure leaves the files before it applied and recorded, and the save is told as part
 *   held, naming the files kept and recorded nowhere and what to run next.
 * - A table no history records yet is adopted by the save that first changes it, and recorded so
 *   in the change's own transaction: a change that fails leaves neither the adoption nor the
 *   change recorded, and no file, on every dialect.
 *
 * On SQLite and PostgreSQL a save's files run in one transaction, so a later file's failure takes
 * the earlier ones back: `failed-save-leaves-things-as-they-were` holds that for every Builder road.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { readTableDefinition } from "../../__tests__/helpers/table-definition";
import { SchemaEventsRepository } from "../../events/schema-events-repository";

import { withNoHistory } from "./helpers/older-table";

// The test's seam on the migration files a save runs: a statement `fileFailure.matches` names is
// sent as one the database refuses, so the file stops at that statement inside the real runner.
const fileFailure = vi.hoisted(() => ({
  matches: undefined as RegExp | undefined,
}));
vi.mock("../../busy-table/run-unit", async original => {
  const actual = await original<typeof import("../../busy-table/run-unit")>();
  return {
    ...actual,
    runUnitInTries: (
      ...[adapter, statements, ...rest]: Parameters<
        typeof actual.runUnitInTries
      >
    ) => {
      const matches = fileFailure.matches;
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

// The test's seam on the check a file's statements get before any runs (a column made Required over
// rows that hold none): from the call `refuseFrom` counts to, the check refuses.
const requiredGuard = vi.hoisted(() => ({
  calls: 0,
  refuseFrom: undefined as number | undefined,
  /** The file the check refused, by the name the run gives it. */
  refused: undefined as string | undefined,
}));
vi.mock("../../migrate/required-column-guard", async original => {
  const actual =
    await original<typeof import("../../migrate/required-column-guard")>();
  return {
    ...actual,
    refuseRequiredColumnsOverNulls: async (
      ...args: Parameters<typeof actual.refuseRequiredColumnsOverNulls>
    ) => {
      requiredGuard.calls += 1;
      if (
        requiredGuard.refuseFrom !== undefined &&
        requiredGuard.calls >= requiredGuard.refuseFrom
      ) {
        requiredGuard.refused ??= args[3];
        throw new Error("a column made Required over rows that hold none");
      }
      return actual.refuseRequiredColumnsOverNulls(...args);
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
type Field = Record<string, unknown>;

for (const dialect of getConfiguredTestDialects()) {
  describe(`a Builder save of several migration files (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-save-files-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
    });

    afterEach(async () => {
      fileFailure.matches = undefined;
      requiredGuard.calls = 0;
      requiredGuard.refuseFrom = undefined;
      requiredGuard.refused = undefined;
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
    const columnsOf = async (table: string) =>
      (
        await readTableDefinition(
          statement => exec(statement),
          adapterOf().getCapabilities().dialect,
          table
        )
      ).columns.map(column => column.name);
    const versionOf = async (registry: string, slug: string) => {
      const [row] = await exec<{ version: number | string | null }>(
        `SELECT schema_version AS version FROM ${registry} WHERE slug = '${slug}'`
      );
      return Number(row?.version ?? 1);
    };

    // A translated field added to a translated Single is written as the Single's own file and a
    // file of its translations table's: the second fails at the column it adds.
    it.skipIf(dialect !== "mysql")(
      "tells a later file's failure as part held, the earlier file recorded applied and the rest kept",
      async () => {
        const heading: Field = {
          name: "heading",
          type: "text",
          localized: true,
        };
        await dispatchSingles(
          "createSingle",
          {},
          { slug: "hero", label: "Hero", fields: [heading], localized: true }
        );
        const appliedBefore = await applied();
        const filesBefore = files();
        fileFailure.matches =
          /single_hero_locales[`"]?\s.*ADD (COLUMN )?[`"]extra[`"]/;

        const failed = await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: [heading, { name: "extra", type: "text", localized: true }],
            confirmed: true,
            schemaVersion: await versionOf("dynamic_singles", "hero"),
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );
        fileFailure.matches = undefined;

        const written = files().filter(name => !filesBefore.includes(name));
        expect(written.length, written.join(", ")).toBeGreaterThan(1);
        const recorded = (await applied()).filter(
          name => !appliedBefore.includes(name)
        );
        // The files before the one that failed are recorded applied, and every later one is kept,
        // recorded nowhere, and named with the step that records it.
        expect(recorded.length).toBeGreaterThan(0);
        const kept = written.filter(name => !recorded.includes(name));
        expect(kept.length).toBeGreaterThan(0);
        const said = (failed as { publicMessage?: string }).publicMessage ?? "";
        expect(said).toContain("The database now holds part of this change");
        for (const name of kept) expect(said).toContain(name);
        expect(said).toContain("nextly migrate:resolve --applied");
      },
      120_000
    );

    // A later file refused before its first statement, after the save's first file applied, is the
    // same part-held save as one failing at a statement.
    it.skipIf(dialect !== "mysql")(
      "tells a later file's refusal before its first statement as part held",
      async () => {
        const heading: Field = {
          name: "heading",
          type: "text",
          localized: true,
        };
        await dispatchSingles(
          "createSingle",
          {},
          { slug: "hero", label: "Hero", fields: [heading], localized: true }
        );
        const filesBefore = files();
        const appliedBefore = await applied();
        requiredGuard.calls = 0;
        requiredGuard.refuseFrom = 2;

        const failed = await dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: [heading, { name: "extra", type: "text", localized: true }],
            confirmed: true,
            schemaVersion: await versionOf("dynamic_singles", "hero"),
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );
        requiredGuard.refuseFrom = undefined;

        // The save's files in the order they run, which their names keep.
        const written = files().filter(name => !filesBefore.includes(name));
        const recorded = (await applied()).filter(
          name => !appliedBefore.includes(name)
        );
        const at = written.indexOf(requiredGuard.refused ?? "");
        // Refused after the first: the files before it recorded applied, it and every one after it
        // kept, recorded nowhere, and named in the answer.
        expect(
          at,
          `${String(requiredGuard.refused)} in ${written.join(", ")}`
        ).toBeGreaterThan(0);
        expect(recorded).toEqual(written.slice(0, at));
        const kept = written.slice(at);
        const said = (failed as { publicMessage?: string }).publicMessage ?? "";
        expect(said).toContain("The database now holds part of this change");
        for (const name of kept) expect(said).toContain(name);
        for (const name of recorded) expect(said).not.toContain(name);
      },
      120_000
    );

    // The adoption of a table no history records is recorded in the change's own transaction, so a
    // change that fails records neither, and writes no file.
    it("leaves a table it would adopt unrecorded when the change after the adoption fails", async () => {
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "posts",
          label: "posts",
          fields: [{ name: "heading", type: "text" }],
        }
      );
      await withNoHistory(t, dialect as TestDialect, "migrations");
      const columns = await columnsOf("dc_posts");
      fileFailure.matches = /dc_posts[`"]?\s.*ADD (COLUMN )?[`"]extra[`"]/;

      const failed = await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "extra", type: "text" },
          ],
          confirmed: true,
          schemaVersion: await versionOf("dynamic_collections", "posts"),
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
      fileFailure.matches = undefined;

      expect(failed).toBeDefined();
      expect(files()).toEqual([]);
      expect(await applied()).toEqual([]);
      expect(await columnsOf("dc_posts")).toEqual(columns);
    }, 120_000);
  });
}
