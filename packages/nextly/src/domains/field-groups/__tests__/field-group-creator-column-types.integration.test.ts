/**
 * A field group created where no Builder save writer is set up gets the column descriptor's column
 * types, on every dialect, and reconciles healthy; one whose columns its creator spelled the earlier
 * way still reconciles healthy.
 *
 * ## Why the route matters
 *
 * A field group's table is built by one of two routes. Where a Builder save writer is set up, the
 * save's migration builds it from the column descriptor (`field-column-descriptor.ts`). Where none
 * is (no `entitySaveDeps`), the field group's own creator (`FieldGroupSchemaService`) renders the
 * CREATE TABLE and runs it; `nextly db:sync` takes the same creator for a code-first field group's
 * table. That creator kept a type map of its own and spelled some columns differently (a
 * PostgreSQL email `VARCHAR(255)`, a single reference `UUID`, a MySQL date `DATETIME`, a `hasMany`
 * number a scalar column), so the two routes made different tables for one definition. It now reads
 * every column type from the descriptor; this file holds that on the real databases.
 *
 * Tables the creator built before that keep their columns, and nothing migrates them, so the second
 * half plants that earlier spelling on every column it differed in and requires reconcile to still
 * call the group healthy.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set, and each dialect gets its own throwaway database.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";
import { typesDiffer } from "../../schema/pipeline/diff/declared-size";
import {
  getComponentRowColumnDescriptor,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import {
  FieldGroupMetadataService,
  type CreateFieldGroupInput,
} from "../services/field-group-metadata-service";
import { reconcileFieldGroup } from "../services/field-group-reconcile-service";
import { preBuilderSaveColumnType } from "../services/pre-builder-save-column-type";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/**
 * One field per column shape the creator renders, the shapes its earlier map spelled differently
 * included: a bounded string, a single reference, a date, a whole and a fractional number, an exact
 * decimal, and the list-holding `hasMany` number and select. None is required, so a planted column
 * can be added back to a table that already exists on SQLite.
 */
const FIELDS = [
  { name: "a_text", type: "text" },
  { name: "a_email", type: "email" },
  { name: "a_password", type: "password" },
  { name: "a_textarea", type: "textarea" },
  { name: "a_number", type: "number" },
  { name: "a_float", type: "number", options: { format: "float" } },
  { name: "a_decimal", type: "number", dbType: "decimal" },
  { name: "a_numbers", type: "number", hasMany: true },
  { name: "a_checkbox", type: "checkbox" },
  { name: "a_date", type: "date" },
  { name: "a_json", type: "json" },
  { name: "a_icon", type: "icon" },
  {
    name: "a_select",
    type: "select",
    options: [{ label: "One", value: "one" }],
  },
  {
    name: "a_tags",
    type: "select",
    hasMany: true,
    options: [{ label: "One", value: "one" }],
  },
  {
    name: "a_radio",
    type: "radio",
    options: [{ label: "One", value: "one" }],
  },
  // Declares the index both creators give every single reference anyway: reconcile reads an index
  // the field does not declare as one to record, which is a question about indexes, not types.
  { name: "a_ref", type: "relationship", relationTo: "users", index: true },
];

/** The fields as the creator's input carries them. */
const INPUT_FIELDS = FIELDS as unknown as CreateFieldGroupInput["fields"];

/** The field as the column descriptor and the earlier spelling read it. */
type DescribedField = Parameters<typeof getComponentRowColumnDescriptor>[0];

/**
 * The columns each server's creator spelled differently before it read the descriptor, as the
 * planting below finds them. Named rather than counted, so a planting that reached the wrong
 * columns, or none, fails here rather than passing on an untouched table.
 */
const EARLIER_SPELLED: Record<SupportedDialect, string[]> = {
  postgresql: [
    "a_email",
    "a_password",
    "a_numbers",
    "a_select",
    "a_tags",
    "a_radio",
    "a_ref",
  ],
  mysql: ["a_numbers", "a_date", "a_tags"],
  sqlite: ["a_numbers"],
};

for (const dialect of getConfiguredTestDialects()) {
  describe(`a field group made by its own creator — ${dialect}`, () => {
    /**
     * A field group created through the route with no Builder save writer: the metadata service
     * built without one, so the create renders and runs the creator's own DDL.
     */
    async function createWithoutSaveWriter(
      slug: string
    ): Promise<{ tableName: string; migrationStatus: string }> {
      current = await createTestNextly({ dialect });
      const tableName = resolveComponentTableName(slug);
      const service = new FieldGroupMetadataService(
        current.getService("fieldGroupRegistryService"),
        current.getService("logger"),
        current.adapter
      );
      const { migrationStatus } = await service.createFieldGroup({
        slug,
        label: "Creator columns",
        tableName,
        fields: INPUT_FIELDS,
        source: "ui",
        locked: false,
        schemaHash: "creator-columns",
      });
      return { tableName, migrationStatus };
    }

    /** The live main table's columns, by name. */
    async function liveColumns(tableName: string) {
      const snapshot = await introspectLiveColumns(
        current!.adapter.getDrizzle(),
        dialect,
        [tableName]
      );
      return new Map(
        (snapshot.tables[0]?.columns ?? []).map(column => [column.name, column])
      );
    }

    async function reconcile(slug: string) {
      return reconcileFieldGroup({
        registry: current!.getService("fieldGroupRegistryService"),
        adapter: current!.adapter,
        logger: current!.getService("logger"),
        slug,
      });
    }

    it("creates every column as the column descriptor types it", async () => {
      const { tableName, migrationStatus } = await createWithoutSaveWriter(
        `creator_cols_${dialect.slice(0, 2)}`
      );
      const live = await liveColumns(tableName);

      // Each field whose live column is not the descriptor's type, named with both spellings, so
      // a failure says which field and how it was created.
      const differing = FIELDS.flatMap(field => {
        const descriptor = getComponentRowColumnDescriptor(
          field as unknown as DescribedField,
          dialect,
          "fieldGroup"
        );
        const column = live.get(field.name);
        if (!descriptor || !column) {
          return [`${field.name}: no ${descriptor ? "column" : "descriptor"}`];
        }
        return typesDiffer(column, {
          name: column.name,
          type: descriptor.dialectType,
          nullable: descriptor.nullable,
        })
          ? [
              `${field.name}: live ${column.type}, descriptor ${descriptor.dialectType}`,
            ]
          : [];
      });
      expect(differing).toEqual([]);
      // The create's own check compares the table it made with the descriptor's, so it records the
      // create applied only once the two agree.
      expect(migrationStatus).toBe("applied");
    });

    it("reconciles the field group it created to no change", async () => {
      const slug = `creator_rec_${dialect.slice(0, 2)}`;
      expect((await createWithoutSaveWriter(slug)).migrationStatus).toBe(
        "applied"
      );

      const report = await reconcile(slug);

      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.adopted.map(a => a.fieldName)).toEqual([]);
      expect(report.unchanged).toBe(true);
    });

    it("still reconciles a table whose columns carry the creator's earlier spelling", async () => {
      const slug = `creator_old_${dialect.slice(0, 2)}`;
      const { tableName, migrationStatus } =
        await createWithoutSaveWriter(slug);
      expect(migrationStatus).toBe("applied");
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      // Every column the earlier spelling differs in, put back into that spelling. The table is
      // empty, so no value is converted. SQLite cannot retype a column in place, so there the
      // column is dropped and added again in the earlier type.
      const live = await liveColumns(tableName);
      const planted: string[] = [];
      for (const field of FIELDS) {
        const earlier = preBuilderSaveColumnType(
          field as unknown as Parameters<typeof preBuilderSaveColumnType>[0],
          dialect
        );
        const column = live.get(field.name);
        if (earlier === null || !column) continue;
        if (
          !typesDiffer(column, {
            name: column.name,
            type: earlier,
            nullable: column.nullable,
          })
        ) {
          continue;
        }
        const statements =
          dialect === "postgresql"
            ? [
                `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(field.name)} TYPE ${earlier} USING NULL`,
              ]
            : dialect === "mysql"
              ? [
                  `ALTER TABLE ${q(tableName)} MODIFY ${q(field.name)} ${earlier} NULL`,
                ]
              : [
                  `ALTER TABLE ${q(tableName)} DROP COLUMN ${q(field.name)}`,
                  `ALTER TABLE ${q(tableName)} ADD COLUMN ${q(field.name)} ${earlier}`,
                ];
        for (const statement of statements) {
          await current!.adapter.executeQuery(statement);
        }
        planted.push(field.name);
      }
      expect(planted).toEqual(EARLIER_SPELLED[dialect]);

      const report = await reconcile(slug);

      expect(report.removed.map(r => r.fieldName)).toEqual([]);
      expect(report.repaired.map(r => `${r.fieldName}.${r.attribute}`)).toEqual(
        []
      );
      expect(report.adopted.map(a => a.fieldName)).toEqual([]);
      expect(report.unchanged).toBe(true);
    });
  });
}
