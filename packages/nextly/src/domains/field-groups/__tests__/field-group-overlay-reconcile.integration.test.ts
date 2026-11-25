/**
 * A field group's repeaters and groups keep one structure in every language, with each language's
 * text inside them on the per-language table: the container's column is on BOTH tables, its
 * structure on the main one and that language's overlay, under the same name, on the other.
 *
 * The reconcile refuses a column it finds on both tables, since a half-applied enable leaves a
 * field's values there twice and nothing says which copy is live. An overlay column is the one
 * column both tables are meant to hold, so it is accepted, by its exact name alone: the column of
 * a container that keeps text inside, in a translated group. Every other column on both tables is
 * still refused. What separates a correct reconcile from a broken one:
 *
 * - a reconcile refusing every translated field group with a group or repeater inside it;
 * - one accepting any column on both tables, hiding a half-applied enable it should refuse;
 * - one accepting a container's column on both tables where the container keeps no text inside,
 *   which has no overlay and so has no reason to be on the per-language table.
 *
 * Self-skips per dialect on the standard rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Field groups keep their text per language as every installation does (`storage-layout`).
perLanguageStorageSuite();

let current: TestNextly | undefined;

// A field group's Builder create builds its tables in development only, as a development server
// does; these cases judge the tables a create leaves.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

/** A translated group's fields: a text, a group keeping text inside, and one keeping none. */
const FIELDS = [
  { name: "heading", type: "text" },
  {
    name: "box",
    type: "group",
    fields: [{ name: "label", type: "text" }],
  },
  {
    name: "stats",
    type: "group",
    fields: [{ name: "visits", type: "number" }],
  },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a field group's overlay columns, reconciled — ${dialect}`, () => {
    const slug = `fgov_${dialect.slice(0, 2)}`;

    /** A translated group made by the Builder, and its main table's name. */
    async function seed(): Promise<{ registry: unknown; table: string }> {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      const registry = current.getService("fieldGroupRegistryService");
      const created = await current.nextly.fieldGroups.create({
        slug,
        label: "Overlay subject",
        localized: true,
        fields: FIELDS,
      } as never);
      // Its translations table made whole by the create's own migration, the overlay column among
      // it, and not added again after: a second ADD would record the create as failed.
      expect((created as { message: string }).message).toBe(
        "Field group created."
      );
      const row = await registry.getComponent(slug);
      return { registry, table: row.tableName };
    }

    /** The columns `table` holds, as the database names them. */
    async function columnsOf(table: string): Promise<string[]> {
      const rows = await current!.adapter.executeQuery<{
        column_name: string;
      }>(
        dialect === "sqlite"
          ? `SELECT name AS column_name FROM pragma_table_info('${table}')`
          : dialect === "postgresql"
            ? `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
            : `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
      );
      return rows.map(row => String(row.column_name).toLowerCase());
    }

    /** Adds `column` to `table` as text, as a change applied half-way would leave it. */
    async function addColumn(table: string, column: string): Promise<void> {
      const q = dialect === "mysql" ? "`" : '"';
      await current!.adapter.executeQuery(
        `ALTER TABLE ${q}${table}${q} ADD COLUMN ${q}${column}${q} TEXT`
      );
    }

    async function preview(registry: unknown) {
      const { previewFieldGroupReconcile } = await import(
        "../services/field-group-reconcile-service"
      );
      return previewFieldGroupReconcile({
        registry: registry as Parameters<
          typeof previewFieldGroupReconcile
        >[0]["registry"],
        adapter: current!.adapter,
        slug,
      });
    }

    it("accepts a container's overlay column, on both tables under its own name", async () => {
      const { registry, table } = await seed();
      // The premise: the group's structure on the main table, its text in an overlay beside it.
      expect(await columnsOf(table)).toContain("box");
      expect(await columnsOf(`${table}_locales`)).toContain("box");

      const report = await preview(registry);

      expect(report.blockers).toEqual([]);
    });

    it("still refuses a translated field's column on both tables", async () => {
      const { registry, table } = await seed();
      // A half-applied enable: the translated `heading` back on the main table beside its
      // per-language column.
      expect(await columnsOf(`${table}_locales`)).toContain("heading");
      await addColumn(table, "heading");

      const report = await preview(registry);

      expect(report.blockers).toEqual([
        expect.objectContaining({
          fieldName: "heading",
          kind: "column-on-both-tables",
        }),
      ]);
    });

    it("still refuses the column of a container that keeps no text inside, on both tables", async () => {
      const { registry, table } = await seed();
      // `stats` holds a number alone, so it has no overlay: its column on the per-language table
      // is no overlay of it.
      expect(await columnsOf(`${table}_locales`)).not.toContain("stats");
      await addColumn(`${table}_locales`, "stats");

      const report = await preview(registry);

      expect(report.blockers).toEqual([
        expect.objectContaining({
          fieldName: "stats",
          kind: "column-on-both-tables",
        }),
      ]);
    });

    // A group added to a translated field group in a Builder save gets its overlay column in that
    // save, recorded as the save's own, so the next save finds the per-language table as the
    // history says and goes ahead. Broken, either the column is missing and the group's text has
    // nowhere to go in another language, or it is made outside the save's record and the next save
    // is refused as drift.
    it("gives a group added in a save its overlay column, and the next save goes ahead", async () => {
      current = await createTestNextly({
        dialect,
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      const registry = current.getService("fieldGroupRegistryService");
      await current.nextly.fieldGroups.create({
        slug,
        label: "Overlay subject",
        localized: true,
        fields: [FIELDS[0]],
      } as never);
      const { tableName: table } = await registry.getComponent(slug);

      // As the Schema Builder applies a change: its fields, confirmed, at the version it read.
      const apply = async (fields: unknown[]) => {
        const { schemaVersion } = await registry.getComponent(slug);
        const { dispatchComponents } = await import(
          "../../../dispatcher/handlers/component-dispatcher"
        );
        await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug },
          { fields, confirmed: true, schemaVersion }
        );
      };

      await apply(FIELDS.slice(0, 2));
      expect(await columnsOf(`${table}_locales`)).toContain("box");

      await apply([...FIELDS.slice(0, 2), { name: "caption", type: "text" }]);
      expect(await columnsOf(`${table}_locales`)).toEqual(
        expect.arrayContaining(["box", "caption"])
      );
    });
  });
}
