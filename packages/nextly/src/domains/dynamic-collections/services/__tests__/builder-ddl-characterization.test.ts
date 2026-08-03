/**
 * What the Schema Builder's DDL looks like today, pinned exactly.
 *
 * This suite asserts nothing about what the SQL *should* be. It records what it *is*, so that a
 * change which is supposed to move this code without altering its output can be shown to have done
 * that rather than asserted to have done it.
 *
 * The Builder's create DDL is about to be relocated out of the request handlers and into services,
 * so a single write and its registry row can be held under one migration lock. That move is only
 * safe if the emitted SQL is untouched, and "untouched" is a claim a diff of moved code cannot
 * settle — the generator is called from a new place with arguments assembled differently, and a
 * dropped option changes the table while every test that checks column *presence* still passes.
 *
 * Whole strings rather than substrings, on purpose: the failure this guards against is a column
 * silently changing type, losing NOT NULL, or gaining a default, and a substring assertion sees none
 * of those.
 *
 * If one of these fails, the question is never "update the expectation". It is "was this change
 * meant to alter the DDL?" — and if it was, the expectation moves in the same commit as the reason.
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

function generate(
  dialect: Dialect,
  options: Parameters<DynamicCollectionSchemaService["generateMigrationSQL"]>[2]
): string {
  return new DynamicCollectionSchemaService(undefined, dialect)
    .generateMigrationSQL("single_pinned", FIELDS, options)
    .trim();
}

describe("builder DDL — pinned as it is today", () => {
  describe.each<Dialect>(["postgresql", "mysql", "sqlite"])("%s", dialect => {
    it("emits the same CREATE for a single", () => {
      expect(generate(dialect, { isSingle: true })).toMatchSnapshot();
    });

    it("emits the same CREATE for a single with Draft/Published", () => {
      expect(
        generate(dialect, { isSingle: true, hasStatus: true })
      ).toMatchSnapshot();
    });

    // Translatable columns move to the companion table, so the main CREATE must lose them. A
    // relocation that drops this option would recreate them on main and strand the companion.
    it("emits the same CREATE for a localized single", () => {
      expect(
        generate(dialect, { isSingle: true, localized: true })
      ).toMatchSnapshot();
    });

    it("emits the same CREATE for a collection", () => {
      expect(generate(dialect, { isSingle: false })).toMatchSnapshot();
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
