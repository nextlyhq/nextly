/**
 * What the Schema Builder's DDL generators emit, recorded exactly.
 *
 * These assert nothing about what the SQL *should* be. They record what it *is*, so that a change
 * which is meant to leave the emitted DDL alone can be shown to have done so rather than assumed to.
 *
 * That distinction matters because the generators are called from several places with their
 * arguments assembled differently, and an option dropped at one call site changes the table while
 * every test asserting a column *exists* still passes.
 *
 * Whole strings rather than substrings, on purpose: the failure worth catching is a column quietly
 * changing type, losing NOT NULL, or gaining a default, and a substring assertion sees none of those.
 *
 * A failure here never means "update the expectation". It asks whether the change was meant to alter
 * the DDL — and if it was, the expectation moves in the same commit as the reason.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import type { FieldConfig } from "../../../../collections/fields/types";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";

/**
 * A field of every shape the Builder's own DDL treats differently: free text, a bounded string, a
 * whole number, a fractional number, a boolean, a date, structured data, and the two column-level
 * constraints the Builder can set.
 */
const FIELDS: FieldDefinition[] = [
  { name: "title", type: "text", required: true },
  { name: "slugKey", type: "text", unique: true },
  { name: "summary", type: "textarea" },
  { name: "views", type: "number" },
  { name: "rating", type: "number", options: { format: "float" } },
  { name: "published", type: "checkbox" },
  { name: "publishedAt", type: "date" },
  { name: "payload", type: "json" },
  { name: "lookupCode", type: "text", index: true },
];

/**
 * The table name carries the case, not just the option: `generateMigrationSQL` treats any
 * `single_`-prefixed name as a single regardless of `isSingle`, so a collection asserted under a
 * `single_` name silently snapshots the single branch and leaves collection-only columns unpinned.
 */
function generate(
  dialect: Dialect,
  tableName: string,
  options: Parameters<DynamicCollectionSchemaService["generateMigrationSQL"]>[2]
): string {
  return new DynamicCollectionSchemaService(undefined, dialect)
    .generateMigrationSQL(tableName, FIELDS, options)
    .trim();
}

const SINGLE_TABLE = "single_pinned";
const COLLECTION_TABLE = "dc_pinned";

describe("builder DDL — pinned as it is today", () => {
  describe.each<Dialect>(["postgresql", "mysql", "sqlite"])("%s", dialect => {
    it("emits the same CREATE for a single", () => {
      expect(
        generate(dialect, SINGLE_TABLE, { isSingle: true })
      ).toMatchSnapshot();
    });

    it("emits the same CREATE for a single with Draft/Published", () => {
      expect(
        generate(dialect, SINGLE_TABLE, { isSingle: true, hasStatus: true })
      ).toMatchSnapshot();
    });

    // Translatable columns move to the companion table, so the main CREATE must lose them. A
    // relocation that drops this option would recreate them on main and strand the companion.
    it("emits the same CREATE for a localized single", () => {
      expect(
        generate(dialect, SINGLE_TABLE, { isSingle: true, localized: true })
      ).toMatchSnapshot();
    });

    it("emits the same CREATE for a collection", () => {
      expect(
        generate(dialect, COLLECTION_TABLE, { isSingle: false })
      ).toMatchSnapshot();
    });
  });
});

describe("field group DDL — pinned as it is today", () => {
  describe.each<Dialect>(["postgresql", "mysql", "sqlite"])("%s", dialect => {
    // A field group's table carries its own system columns (parent linkage, ordering, the type
    // discriminator) rather than a collection's, and a different generator renders them. It moves
    // in the same relocation, so it is pinned the same way.
    it("emits the same CREATE for a field group", () => {
      const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
        "comp_pinned",
        FIELDS as unknown as FieldConfig[]
      );

      expect(sql.trim()).toMatchSnapshot();
    });

    it("emits the same CREATE for a localized field group", () => {
      const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
        "comp_pinned",
        FIELDS as unknown as FieldConfig[],
        { localized: true }
      );

      expect(sql.trim()).toMatchSnapshot();
    });
  });
});
