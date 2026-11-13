/**
 * Every entry point follows the stored schema version, on every dialect: the
 * Direct API as the admin API does, and every registry delete moves it.
 *
 * A site renders its pages through the Direct API, and a script reads
 * through nothing else, so a process that has served no admin request still
 * has to follow a schema changed by another copy: before, it kept the
 * definitions it started with for as long as it ran, and a field added
 * elsewhere was never read. Every registry delete now moves the stored
 * version too, the ones the dev commands make on their own included: another
 * process (a running dev server) follows the registry by it, and went on
 * serving a deleted collection or Single from its cache until some other
 * registry write happened.
 */
import { afterEach, describe, expect, it } from "vitest";

import { recordStatements } from "../../../__tests__/helpers/record-statements";
import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  deleteEntityRegistryRow,
  type DashboardTables,
} from "../../versions/entity-teardown";
import { reloadDynamicTables } from "../../../init/reload-dynamic-tables";
import {
  createSchemaRegistry,
  initializeSchemaRegistry,
} from "../../../di/register";
import {
  definitionsLoaded,
  loadingDefinitions,
  versionBeforeLoading,
} from "../../../route-handler/schema-version";
import {
  readSchemaVersion,
  storeSchemaVersion,
  writeRegistryRows,
} from "../schema-version";
import { SCHEMA_VERSION_READ_INTERVAL_MS } from "../stored-schema-seq";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pause = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** The statements of `texts` that load the definitions from a registry table. */
function definitionLoads(texts: readonly string[]): string[] {
  return texts.filter(text =>
    /^\s*select\s+table_name,\s*fields\b/i.test(text)
  );
}

/** The statements of `texts` that read the stored schema version. */
function versionReads(texts: readonly string[]): string[] {
  return texts.filter(text =>
    /^\s*select\b[\s\S]*\bfrom\s+["`]?nextly_meta["`]?/i.test(text)
  );
}

/** Nothing to sweep beyond the registry row and the versions domain. */
const NO_TABLES: DashboardTables = {
  dashboardPinsPresent: false,
  mediaUsagePresent: false,
};

describe.each(getConfiguredTestDialects())(
  "every entry point follows the stored schema version (%s)",
  dialect => {
    async function seqOf(t: TestNextly): Promise<number> {
      const stored = await readSchemaVersion(t.adapter.getDrizzle(), dialect);
      return stored.present ? (stored.version?.seq ?? 0) : 0;
    }

    it("reads a field another copy added through the Direct API, once the interval has passed", async () => {
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "notes",
            fields: [text({ name: "title" })],
          }),
        ],
      }));
      const created = await t.nextly.create({
        collection: "notes",
        data: { title: "First" },
      });
      const id = String(created.item.id);
      expect(
        await t.nextly.findByID({ collection: "notes", id })
      ).not.toHaveProperty("subtitle");

      // Another copy adds a field: the column, the registry row's fields and
      // the stored version, in one transaction, past this process.
      const [row] = await t.adapter.select<{ fields: unknown }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: "notes" }] } }
      );
      const fields = (
        typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields
      ) as Record<string, unknown>[];
      const q = dialect === "mysql" ? "`" : '"';
      const [registry] = await t.adapter.select<{ tableName: string }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: "notes" }] } }
      );
      await t.adapter.executeQuery(
        `ALTER TABLE ${q}${registry.tableName}${q} ADD COLUMN ${q}subtitle${q} ${
          dialect === "mysql" ? "varchar(255)" : "text"
        }`
      );
      await t.adapter.transaction(async tx => {
        await tx.update(
          "dynamic_collections",
          {
            fields: JSON.stringify([
              ...fields,
              { type: "text", name: "subtitle" },
            ]),
          },
          { and: [{ column: "slug", op: "=", value: "notes" }] }
        );
        await storeSchemaVersion(tx.getDrizzle(), dialect, { wrote: true });
      });
      await t.adapter.executeQuery(
        `UPDATE ${q}${registry.tableName}${q} SET ${q}subtitle${q} = 'Added elsewhere'`
      );

      await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);
      const read = (await t.nextly.findByID({
        collection: "notes",
        id,
      })) as Record<string, unknown> | null;
      expect(read?.subtitle).toBe("Added elsewhere");
    });

    it("does not load again definitions a start loaded, and still follows a change made after it", async () => {
      // The start loads every definition and records the stored version it
      // loaded them at (`loadingDefinitions`), so following the version from
      // the Direct API costs a page-only process one read of the version, not
      // a second load of everything. Without the record, the first follow
      // could not tell what had been loaded and loaded it all again.
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "first",
            fields: [text({ name: "title" })],
          }),
        ],
      }));
      // Whatever the test start left for its first follow (its code-first
      // sync writes the registry after the load) is settled first.
      await t.nextly.find({ collection: "first" });
      // Then this process is made one that has followed nothing yet, as a
      // page-only instance is just after its start: the served version's
      // state is put aside, and put back after.
      const holder = globalThis as unknown as Record<string, unknown>;
      const servedBefore = holder.__nextly_servedSchema;
      delete holder.__nextly_servedSchema;
      try {
        // A start's load, recorded as the start records it.
        await loadingDefinitions(() => reloadDynamicTables("[test]"), {
          adapter: t.adapter,
        });
        await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);

        const followed = await recordStatements(t.adapter, dialect);
        try {
          await t.nextly.find({ collection: "first" });
        } finally {
          followed.uninstall();
        }
        expect(definitionLoads(followed.statements)).toEqual([]);
        // POPULATION CONTROL: the version itself was read again.
        expect(versionReads(followed.statements).length).toBeGreaterThan(0);

        // A change another copy makes after the load is still followed.
        await t.adapter.transaction(async tx => {
          await storeSchemaVersion(tx.getDrizzle(), dialect, { wrote: true });
        });
        await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);
        const moved = await recordStatements(t.adapter, dialect);
        try {
          await t.nextly.find({ collection: "first" });
        } finally {
          moved.uninstall();
        }
        expect(definitionLoads(moved.statements).length).toBeGreaterThan(0);
      } finally {
        holder.__nextly_servedSchema = servedBefore;
      }
    });

    /** This process made one that has followed nothing yet, for `run`, then put back. */
    async function asIfJustStarted(run: () => Promise<void>): Promise<void> {
      const holder = globalThis as unknown as Record<string, unknown>;
      const servedBefore = holder.__nextly_servedSchema;
      delete holder.__nextly_servedSchema;
      try {
        await run();
      } finally {
        holder.__nextly_servedSchema = servedBefore;
      }
    }

    /** The definition loads one Direct API call of `t`'s sends. */
    async function loadsOnNextCall(t: TestNextly): Promise<string[]> {
      const recorder = await recordStatements(t.adapter, dialect);
      try {
        await t.nextly.find({ collection: "first" });
      } finally {
        recorder.uninstall();
      }
      return definitionLoads(recorder.statements);
    }

    it("labels a start's load with the version read before its rows, so a change landing between them is still followed", async () => {
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "first",
            fields: [text({ name: "title" })],
          }),
        ],
      }));
      await t.nextly.find({ collection: "first" });
      await asIfJustStarted(async () => {
        // The order the start keeps: the version first, then the rows.
        const before = await versionBeforeLoading(t.adapter);
        const loaded = await reloadDynamicTables("[test]");
        // Another copy changes the schema after the rows were read, and
        // before anything else could be read.
        await t.adapter.transaction(async tx => {
          await storeSchemaVersion(tx.getDrizzle(), dialect, { wrote: true });
        });
        definitionsLoaded(t.adapter, before, loaded);
        await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);

        // Labelled with the earlier version, the load is not taken for the
        // change: the first follow loads the definitions again.
        expect((await loadsOnNextCall(t)).length).toBeGreaterThan(0);
      });
    });

    it("records no start load that left a definition unregistered, so the first follow loads it again", async () => {
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "first",
            fields: [text({ name: "title" })],
          }),
        ],
      }));
      await t.nextly.find({ collection: "first" });
      const where = {
        and: [{ column: "slug", op: "=" as const, value: "first" }],
      };
      const [row] = await t.adapter.select<{ fields: unknown }>(
        "dynamic_collections",
        { where }
      );
      const good =
        typeof row.fields === "string"
          ? row.fields
          : JSON.stringify(row.fields);
      // One definition that cannot be loaded: its fields are not a list.
      await t.adapter.update(
        "dynamic_collections",
        { fields: JSON.stringify({ not: "a list" }) },
        where
      );

      await asIfJustStarted(async () => {
        const before = await versionBeforeLoading(t.adapter);
        const completeness = { complete: true };
        const registry = await initializeSchemaRegistry(
          t.adapter,
          await createSchemaRegistry(t.adapter),
          undefined,
          { collections: [], singles: [] },
          { createMissingCompanions: false, completeness }
        );
        // The start's own rule: recorded only for a complete load.
        expect(registry).toBeDefined();
        expect(completeness.complete).toBe(false);
        definitionsLoaded(
          t.adapter,
          before,
          registry !== undefined && completeness.complete
        );

        // The definition is put right; the first follow loads every
        // definition again, and the collection reads.
        await t.adapter.update("dynamic_collections", { fields: good }, where);
        await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);
        expect((await loadsOnNextCall(t)).length).toBeGreaterThan(0);
      });

      // POPULATION CONTROL: with every definition loadable, the same start
      // reports a complete load.
      const completeness = { complete: true };
      await initializeSchemaRegistry(
        t.adapter,
        await createSchemaRegistry(t.adapter),
        undefined,
        { collections: [], singles: [] },
        { createMissingCompanions: false, completeness }
      );
      expect(completeness.complete).toBe(true);
    });

    it("records no reload that left a definition unregistered, on the path the boot reloads take", async () => {
      // The reload after boot migrations (`boot-apply`, both production
      // migration paths) records through `loadingDefinitions`, which takes
      // the reload's own answer: an incomplete reload records nothing.
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "first",
            fields: [text({ name: "title" })],
          }),
        ],
      }));
      await t.nextly.find({ collection: "first" });
      const where = {
        and: [{ column: "slug", op: "=" as const, value: "first" }],
      };
      const [row] = await t.adapter.select<{ fields: unknown }>(
        "dynamic_collections",
        { where }
      );
      const good =
        typeof row.fields === "string"
          ? row.fields
          : JSON.stringify(row.fields);
      await t.adapter.update(
        "dynamic_collections",
        { fields: JSON.stringify({ not: "a list" }) },
        where
      );
      await asIfJustStarted(async () => {
        const complete = await loadingDefinitions(
          () => reloadDynamicTables("[test]"),
          { adapter: t.adapter }
        );
        expect(complete).toBe(false);

        await t.adapter.update("dynamic_collections", { fields: good }, where);
        await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);
        expect((await loadsOnNextCall(t)).length).toBeGreaterThan(0);
      });
    });

    it("records a load made after this process wrote registry rows, so the first follow loads nothing again", async () => {
      // Boot migrations and metadata registration write registry rows in this
      // process, marking the change (`bumpSchemaVersion`), and reload after:
      // the version is read fresh after the mark, so the reload holds the
      // write, and its record settles the mark.
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "first",
            fields: [text({ name: "title" })],
          }),
        ],
      }));
      await t.nextly.find({ collection: "first" });
      await asIfJustStarted(async () => {
        await writeRegistryRows(t.adapter, async () => {
          await t.adapter.update(
            "dynamic_collections",
            { description: "Written at boot" },
            { and: [{ column: "slug", op: "=", value: "first" }] }
          );
        });
        const complete = await loadingDefinitions(
          () => reloadDynamicTables("[test]"),
          { adapter: t.adapter }
        );
        expect(complete).toBe(true);
        await pause(SCHEMA_VERSION_READ_INTERVAL_MS + 100);

        expect(await loadsOnNextCall(t)).toEqual([]);
      });
    });

    it("moves the stored version when a registry row is deleted, and only then", async () => {
      const t = (current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "orphans",
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({ slug: "orphan", fields: [text({ name: "heading" })] }),
        ],
      }));

      for (const [kind, slug] of [
        ["collection", "orphans"],
        ["single", "orphan"],
      ] as const) {
        const before = await seqOf(t);
        // As the dev commands delete an orphan: on a transaction of their
        // own, with no registry write open around it.
        const { deleted } = await t.adapter.transaction(tx =>
          deleteEntityRegistryRow(tx, kind, slug, NO_TABLES, dialect)
        );
        expect(deleted, slug).toBe(1);
        expect(await seqOf(t), slug).toBe(before + 1);
      }

      const before = await seqOf(t);
      await t.adapter.transaction(tx =>
        deleteEntityRegistryRow(tx, "single", "never-there", NO_TABLES, dialect)
      );
      expect(await seqOf(t)).toBe(before);
    });
  }
);
