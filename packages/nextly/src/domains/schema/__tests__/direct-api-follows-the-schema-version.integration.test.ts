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
import { readSchemaVersion, storeSchemaVersion } from "../schema-version";
import { SCHEMA_VERSION_READ_INTERVAL_MS } from "../stored-schema-seq";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const pause = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

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
