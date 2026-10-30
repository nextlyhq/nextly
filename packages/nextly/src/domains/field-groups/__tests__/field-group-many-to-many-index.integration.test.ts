/**
 * A field group holding a many-to-many is created, and gains one, on every dialect.
 *
 * A component has no junction table, so a many-to-many keeps its ids on the component's row as a
 * JSON list. Spelled with `relationTo`, the field also reads as a reference to one collection, and
 * that kind of column gets a plain index. MySQL refuses a plain index on a JSON column, and the
 * index statement runs after the `CREATE TABLE` has committed, so a create emitting it fails with
 * the table already made. PostgreSQL and SQLite index the value and keep the index.
 *
 * Created through the dispatcher, as the Builder creates a field group, and changed through its
 * schema apply, as the Builder adds a field. An entry is written and read back through a Single
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

/** The indexes the live database reports on a table. */
async function liveIndexes(
  t: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  const sql = {
    postgresql: `SELECT indexname AS name FROM pg_indexes WHERE tablename = '${table}'`,
    mysql: `SELECT DISTINCT index_name AS name FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = '${table}'`,
    sqlite: `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}'`,
  }[dialect];
  const rows = (await t.adapter.executeQuery(sql)) as unknown;
  const list = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: unknown[] }).rows ?? []);
  return (Array.isArray(list[0]) ? (list[0] as unknown[]) : list).map(row =>
    String((row as { name?: unknown }).name)
  );
}

/** The registry's own view of a field group. */
async function registryRow(
  t: TestNextly,
  slug: string
): Promise<{ migrationStatus?: string } | undefined> {
  const registry = t.getService("fieldGroupRegistryService");
  return (await registry.getComponentBySlug(slug)) ?? undefined;
}

/** Embed the field group in a Single, write two related ids, and read them back. */
async function writeAndReadTwoIds(
  t: TestNextly,
  slug: string
): Promise<{ saved: unknown; read: unknown; ids: string[] }> {
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
  const read = await singles.get(`${slug}_page`, {
    depth: 0,
    overrideAccess: true,
  });
  return {
    // The message travels with the flag so a refused save names its reason.
    saved: { success: saved.success, message: saved.message },
    read: (read.data as { card?: { related?: unknown } }).card?.related,
    ids,
  };
}

describe.each(getConfiguredTestDialects())(
  "a field group's many-to-many on %s",
  (dialect: TestDialect) => {
    // The relation index stays where the dialect can carry it, and only there.
    const relationIndexed = dialect !== "mysql";
    // Per-dialect slugs: the suites share one process, so a leaked row surfaces where it leaked.
    const prefix = `fg_${dialect.slice(0, 2)}`;

    it("is created with the field group, and an entry keeps two related ids", async () => {
      const dialectOption = dialect === "sqlite" ? {} : { dialect };
      handle = await createTestNextly({
        ...dialectOption,
        collections: [tags],
      });
      const slug = `${prefix}_m2m_create`;

      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: "Card", fields: [HEADING, RELATED] }
      );

      // The recorded outcome first: a failed DDL is recorded on the row, not raised.
      expect((await registryRow(handle, slug))?.migrationStatus).toBe(
        "applied"
      );
      expect(
        (await liveIndexes(handle, dialect, `comp_${slug}`)).includes(
          `idx_comp_${slug}_related`
        )
      ).toBe(relationIndexed);

      const { saved, read, ids } = await writeAndReadTwoIds(handle, slug);
      expect(saved).toEqual({ success: true, message: undefined });
      expect(read).toEqual(ids);
    });

    // The schema push the Builder's apply runs, given the group with the field added. Driven here
    // rather than through the apply request because that request's field validator accepts
    // `options` only as a list of choices, so it refuses this spelling before any DDL; the push is
    // the step that alters the table, whichever route reaches it.
    it("is added to an existing field group by the schema push", async () => {
      const dialectOption = dialect === "sqlite" ? {} : { dialect };
      handle = await createTestNextly({
        ...dialectOption,
        collections: [tags],
      });
      const slug = `${prefix}_m2m_alter`;
      const tableName = `comp_${slug}`;

      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: "Card", fields: [HEADING] }
      );
      expect((await registryRow(handle, slug))?.migrationStatus).toBe(
        "applied"
      );

      const desired = await buildFullDesiredSchema();
      desired.components[slug] = {
        slug,
        tableName,
        fields: [HEADING, RELATED] as DesiredFieldGroup["fields"],
        localized: false,
        builderOwned: true,
      };
      const result = await builderSchemaPush({
        dialect,
        db: handle.adapter.getDrizzle(),
        databaseName:
          dialect === "mysql"
            ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
            : undefined,
        slug,
        kind: "component",
        // No renames, no event answers and no legacy answers: a pure add asks nothing.
        resolutions: [[], [], undefined],
      })(desired);

      // The error travels with the flag so a refused push names its statement.
      expect({ success: result.success, error: result.error }).toEqual({
        success: true,
        error: undefined,
      });
      // The column is there: selecting it is refused on a table without it.
      await expect(
        handle.adapter.executeQuery(`SELECT related FROM ${tableName}`)
      ).resolves.toBeDefined();
      expect(
        (await liveIndexes(handle, dialect, tableName)).includes(
          `idx_${tableName}_related`
        )
      ).toBe(relationIndexed);
    });
  }
);
