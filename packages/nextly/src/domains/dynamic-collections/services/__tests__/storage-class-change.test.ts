/**
 * A same-name edit that moves a field between storage classes must be treated
 * as a removal plus an addition, not a modification.
 *
 * Both directions matter, and they fail differently when `storageClassChanged`
 * compares only junction usage: a plain type edited into a field group leaves
 * its old parent-table column behind — the ghost column the next boot sync
 * then offers to drop — and the reverse is treated as a modification of a
 * column the parent table never had.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

const TABLE = "dc_storage_class";
const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;

const asField = (f: Record<string, unknown>): FieldDefinition =>
  f as unknown as FieldDefinition;

describe.each(DIALECTS)(
  "%s: a same-name edit that changes storage class",
  dialect => {
    const service = new DynamicCollectionSchemaService(undefined, dialect);

    it("drops the plain column when the field becomes a field group", () => {
      const sql = service.generateAlterTableMigration(
        TABLE,
        [asField({ name: "bio", type: "text" })],
        [asField({ name: "bio", type: "fieldGroup", fieldGroup: "seo" })]
      );

      // The separating assertion: without the storage-class comparison this edit
      // emits nothing at all, and the old column silently outlives its field.
      expect(sql).toContain("DROP COLUMN");
      // The field group's values live in their own table; the parent row gains
      // no replacement column.
      expect(sql).not.toContain("ADD COLUMN");
    });

    it("adds the plain column when the field stops being a field group", () => {
      const sql = service.generateAlterTableMigration(
        TABLE,
        [asField({ name: "bio", type: "component", component: "seo" })],
        [asField({ name: "bio", type: "text" })]
      );

      expect(sql).toContain("ADD COLUMN");
      // The generators quote identifiers per dialect; `bio` must be the added one.
      expect(sql).toMatch(/ADD COLUMN ["'`]bio["'`]/);
      // Nothing to drop: a field group never occupied a parent-table column, so
      // emitting one here would be an ALTER against a name the table never had.
      expect(sql).not.toContain("DROP COLUMN");
    });

    it("renaming a field group emits no parent-table RENAME COLUMN", () => {
      // A field group has no column on the parent row, so a rename is a change
      // of the association key on its own data table — the alter generator
      // must not emit a rename of a column that cannot exist.
      const sql = service.generateAlterTableMigration(
        TABLE,
        [asField({ name: "seo", type: "component", component: "seo" })],
        [asField({ name: "meta", type: "component", component: "seo" })]
      );

      expect(sql).not.toContain("RENAME COLUMN");
    });
  }
);
