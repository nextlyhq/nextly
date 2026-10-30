/**
 * A field group holding a many-to-many is created, and gains one, on every dialect, with no plain
 * index on the relation's column.
 *
 * A component has no junction table, so a many-to-many keeps its ids on the component's row as a
 * JSON list. Spelled with `relationTo`, the field names one collection, and a column referencing
 * one entry gets a plain index. A list gets none: MySQL refuses a plain index on a JSON column
 * (and the index statement runs after the `CREATE TABLE` has committed, so the create failed with
 * the table already made), and on PostgreSQL a btree entry over a long list exceeds the row size
 * and refuses the save.
 *
 * Created through the dispatcher, as the Builder creates a field group, and changed through the
 * schema push the Builder's apply runs. An entry is written and read back through a Single
 * embedding the group, so the outcome asserted is the one a user sees: the save succeeds and the
 * two related ids come back.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { builderSchemaPush } from "../../../dispatcher/helpers/builder-schema-push";
import { buildFullDesiredSchema } from "../../../dispatcher/helpers/desired-schema";
import { seedBuilderSingle } from "../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { extractDatabaseNameFromUrl } from "../../schema/pipeline/database-url";
import { buildDesiredTableFromComponentFields } from "../../schema/pipeline/diff/build-from-fields";
import { diffSnapshots } from "../../schema/pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import type { Operation } from "../../schema/pipeline/diff/types";
import type { DesiredFieldGroup } from "../../schema/pipeline/types";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const tags = defineCollection({
  slug: "tags",
  fields: [text({ name: "name" })],
});

const HEADING = { name: "heading", type: "text" };
// The code-first spelling of a many-to-many: the target in `relationTo`, the kind on `options`.
const RELATED = {
  name: "related",
  type: "relationship",
  relationTo: "tags",
  options: { relationType: "manyToMany" },
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const dialectOption = dialect === "sqlite" ? {} : { dialect };
  handle = await createTestNextly({ ...dialectOption, collections: [tags] });
  return handle;
}

/** Create the field group as the Builder does, and answer how the registry recorded it. */
async function createGroup(
  t: TestNextly,
  slug: string,
  fields: unknown[]
): Promise<string | undefined> {
  await dispatchComponents(
    "createComponent",
    {},
    { slug, label: "Card", fields }
  );
  const registry = t.getService("fieldGroupRegistryService");
  const row = (await registry.getComponentBySlug(slug)) as
    | { migrationStatus?: string }
    | undefined;
  return row?.migrationStatus;
}

/**
 * Run the schema push the Builder's apply runs, with the group holding `fields`.
 *
 * `earlier` holds the groups this test already pushed. The registry still records their fields
 * from before the push (the apply's own registry write is not part of the push), so without them
 * the desired schema would drop the columns those pushes added.
 */
async function pushGroup(
  t: TestNextly,
  dialect: TestDialect,
  slug: string,
  fields: unknown[],
  earlier: Record<string, unknown[]> = {}
): Promise<unknown> {
  const desired = await buildFullDesiredSchema();
  for (const [groupSlug, groupFields] of Object.entries({
    ...earlier,
    [slug]: fields,
  })) {
    desired.components[groupSlug] = {
      slug: groupSlug,
      tableName: `comp_${groupSlug}`,
      fields: groupFields as DesiredFieldGroup["fields"],
      localized: false,
      builderOwned: true,
    };
  }
  const result = await builderSchemaPush({
    dialect,
    db: t.adapter.getDrizzle(),
    databaseName:
      dialect === "mysql"
        ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
        : undefined,
    slug,
    kind: "component",
    // No renames, no event answers and no legacy answers: these pushes ask nothing.
    resolutions: [[], [], undefined],
  })(desired);
  // The error travels with the flag so a refused push names its statement.
  return { success: result.success, error: result.error };
}

/** The live table as the diff engine reads it: its columns, and the indexes over `related`. */
async function liveTable(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<{ columns: string[]; relatedIndexes: string[] }> {
  const snapshot = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    dialect,
    [table]
  );
  const spec = snapshot.tables.find(candidate => candidate.name === table);
  return {
    columns: (spec?.columns ?? []).map(column => column.name),
    relatedIndexes: (spec?.indexes ?? [])
      .filter(index => index.columns.includes("related"))
      .map(index => index.name),
  };
}

/**
 * What the diff engine plans to bring the live table to this release's desired shape, the
 * comparison `migrate:check` reports and the push applies.
 */
async function pendingOperations(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<Operation[]> {
  const live = await introspectLiveSnapshot(t.adapter.getDrizzle(), dialect, [
    table,
  ]);
  const desired = buildDesiredTableFromComponentFields(
    table,
    [HEADING, RELATED] as never,
    dialect,
    { builtBy: "fieldGroup" }
  );
  return diffSnapshots(live, { tables: [desired] });
}

/** Embed the field group in a Single and write two related ids into it. */
async function writeTwoIds(
  t: TestNextly,
  slug: string
): Promise<{ saved: unknown; ids: string[] }> {
  await seedBuilderSingle(t.adapter, {
    slug: `${slug}_page`,
    fields: [{ name: "card", type: "component", component: slug }],
  });
  const first = await t.nextly.create({
    collection: "tags",
    data: { name: "first" },
  });
  const second = await t.nextly.create({
    collection: "tags",
    data: { name: "second" },
  });
  const ids = [String(first.item.id), String(second.item.id)];

  const singles = t.getService("singleEntryService") as SingleEntryService;
  const saved = await singles.update(
    `${slug}_page`,
    { card: { heading: "Hello", related: ids } },
    { overrideAccess: true }
  );
  // The message travels with the flag so a refused save names its reason.
  return { saved: { success: saved.success, message: saved.message }, ids };
}

/** The related ids the Single embedding the group reads back. */
async function readIds(t: TestNextly, slug: string): Promise<unknown> {
  const singles = t.getService("singleEntryService") as SingleEntryService;
  const read = await singles.get(`${slug}_page`, {
    depth: 0,
    overrideAccess: true,
  });
  return (read.data as { card?: { related?: unknown } }).card?.related;
}

/** The group's stored rows, as the database holds them. */
async function storedRows(t: TestNextly, table: string): Promise<string> {
  const rows = await t.adapter.executeQuery(
    `SELECT id, heading, related FROM ${table} ORDER BY id`
  );
  return JSON.stringify(rows);
}

/**
 * Each kind of field that decides a component column's index, and the indexes its `subject` column
 * carries, the same on every dialect: a list gets none, a reference to one entry or an indexed
 * field gets `idx_`, and a unique field gets `uq_` and no plain index besides.
 */
const INDEX_MATRIX: Record<string, { field: object; indexes: string[] }> = {
  "many-to-many": {
    field: {
      type: "relationship",
      relationTo: "tags",
      options: { relationType: "manyToMany" },
    },
    indexes: [],
  },
  "indexed many-to-many": {
    field: {
      type: "relationship",
      relationTo: "tags",
      options: { relationType: "manyToMany" },
      index: true,
    },
    indexes: [],
  },
  "single relation": {
    field: { type: "relationship", relationTo: "tags" },
    indexes: ["idx"],
  },
  "unique relation": {
    field: { type: "relationship", relationTo: "tags", unique: true },
    indexes: ["uq"],
  },
  unique: {
    field: { type: "text", maxLength: 100, unique: true },
    indexes: ["uq"],
  },
  indexed: {
    field: { type: "text", maxLength: 100, index: true },
    indexes: ["idx"],
  },
};

/** The indexes over `subject` on a live table, by kind (`idx` or `uq`), sorted. */
async function subjectIndexKinds(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  const snapshot = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    dialect,
    [table]
  );
  const spec = snapshot.tables.find(candidate => candidate.name === table);
  return (spec?.indexes ?? [])
    .filter(index => index.columns.includes("subject"))
    .map(index => {
      if (index.name === `idx_${table}_subject`) return "idx";
      if (index.name === `uq_${table}_subject`) return "uq";
      return index.name;
    })
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "a field group column's indexes on %s",
  (dialect: TestDialect) => {
    const prefix = `fg_${dialect.slice(0, 2)}_ix`;
    const expected = Object.fromEntries(
      Object.entries(INDEX_MATRIX).map(([kind, cell]) => [kind, cell.indexes])
    );

    it("are what the field asks for when the group is created with it", async () => {
      const t = await boot(dialect);
      const actual: Record<string, unknown> = {};
      for (const [index, [kind, cell]] of Object.entries(
        INDEX_MATRIX
      ).entries()) {
        const slug = `${prefix}_c${index}`;
        const status = await createGroup(t, slug, [
          HEADING,
          { name: "subject", ...cell.field },
        ]);
        actual[kind] =
          status === "applied"
            ? await subjectIndexKinds(t, dialect, `comp_${slug}`)
            : `create ${String(status)}`;
      }
      expect(actual).toEqual(expected);
    });

    it("are what the field asks for when it is added to an existing group", async () => {
      const t = await boot(dialect);
      const actual: Record<string, unknown> = {};
      const earlier: Record<string, unknown[]> = {};
      for (const [index, [kind, cell]] of Object.entries(
        INDEX_MATRIX
      ).entries()) {
        const slug = `${prefix}_a${index}`;
        const fields = [HEADING, { name: "subject", ...cell.field }];
        expect(await createGroup(t, slug, [HEADING])).toBe("applied");
        const pushed = (await pushGroup(t, dialect, slug, fields, earlier)) as {
          success: boolean;
        };
        earlier[slug] = fields;
        actual[kind] = pushed.success
          ? await subjectIndexKinds(t, dialect, `comp_${slug}`)
          : pushed;
      }
      expect(actual).toEqual(expected);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a field group's many-to-many on %s",
  (dialect: TestDialect) => {
    // Per-dialect slugs: the suites share one process, so a leaked row surfaces where it leaked.
    const prefix = `fg_${dialect.slice(0, 2)}`;

    it("is created with the field group, unindexed, and an entry keeps two related ids", async () => {
      const t = await boot(dialect);
      const slug = `${prefix}_m2m_create`;

      // The recorded outcome first: a failed DDL is recorded on the row, not raised.
      expect(await createGroup(t, slug, [HEADING, RELATED])).toBe("applied");
      expect(
        (await liveTable(t, dialect, `comp_${slug}`)).relatedIndexes
      ).toEqual([]);

      const { saved, ids } = await writeTwoIds(t, slug);
      expect(saved).toEqual({ success: true, message: undefined });
      expect(await readIds(t, slug)).toEqual(ids);
    });

    // Driven through the push rather than the apply request, because that request's field
    // validator accepts `options` only as a list of choices and refuses this spelling before any
    // DDL; the push is the step that alters the table, whichever route reaches it.
    it("is added to an existing field group by the schema push, unindexed", async () => {
      const t = await boot(dialect);
      const slug = `${prefix}_m2m_alter`;
      const tableName = `comp_${slug}`;

      expect(await createGroup(t, slug, [HEADING])).toBe("applied");
      expect(await pushGroup(t, dialect, slug, [HEADING, RELATED])).toEqual({
        success: true,
        error: undefined,
      });

      const live = await liveTable(t, dialect, tableName);
      expect(live.columns).toContain("related");
      expect(live.relatedIndexes).toEqual([]);
    });

    // A PostgreSQL or SQLite site whose field group an earlier release created carries the plain
    // index that release wrote. MySQL never does: that create failed on the index.
    it.skipIf(dialect === "mysql")(
      "drops only the earlier release's index from an existing site, keeping its entries",
      async () => {
        const t = await boot(dialect);
        const slug = `${prefix}_m2m_site`;
        const tableName = `comp_${slug}`;
        const indexName = `idx_${tableName}_related`;

        expect(await createGroup(t, slug, [HEADING, RELATED])).toBe("applied");
        // What any component table this release creates still differs by (the system columns'
        // defaults and the `created_at` index, which the creating SQL and the desired schema
        // already disagree on), so the earlier index is measured against it.
        const asCreatedNow = await pendingOperations(t, dialect, tableName);
        // The statement the earlier release's creating SQL wrote for this column.
        await t.adapter.executeQuery(
          `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}"("related")`
        );
        const { saved, ids } = await writeTwoIds(t, slug);
        expect(saved).toEqual({ success: true, message: undefined });

        // The earlier index adds exactly one pending change: dropping it.
        expect(await pendingOperations(t, dialect, tableName)).toEqual([
          ...asCreatedNow,
          expect.objectContaining({
            type: "drop_index",
            tableName,
            index: expect.objectContaining({ name: indexName }),
          }),
        ]);

        const rowsBefore = await storedRows(t, tableName);
        expect(await pushGroup(t, dialect, slug, [HEADING, RELATED])).toEqual({
          success: true,
          error: undefined,
        });
        expect((await liveTable(t, dialect, tableName)).relatedIndexes).toEqual(
          []
        );

        // Dropping it touched no data.
        expect(await storedRows(t, tableName)).toEqual(rowsBefore);
        expect(await readIds(t, slug)).toEqual(ids);
      }
    );
  }
);
