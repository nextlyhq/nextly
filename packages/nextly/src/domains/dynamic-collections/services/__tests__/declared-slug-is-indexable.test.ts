/**
 * A declared `slug` field gets a column the generated UNIQUE index can be built on.
 *
 * Every table this service creates carries a UNIQUE index on `slug`, and MySQL refuses to index a
 * `TEXT` column without a prefix length. So this column has to be bounded on MySQL whatever else is
 * true of the field, and the generator asks the canonical descriptor for it rather than using its
 * own type map, which renders `text`.
 *
 * That makes it a constraint of the column and not a statement about which builder created the
 * table: reading the width the way the creating service reads it renders `text`, MySQL rejects the
 * CREATE INDEX, and the table is never created at all — taking the localized companion and every
 * read that depends on it with it.
 *
 * The characterization snapshots cannot catch this. Their fixtures name the field `slugKey`, and
 * the canonical lookup fires only on a field whose column is literally `slug`, so that path is
 * never entered there and the `slug varchar(255)` those snapshots pin is the SYSTEM column.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { fieldToColumnDef } from "../../../schema/utils/missing-columns";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

const declaredSlug = [
  { name: "slug", type: "text" },
] as unknown as FieldDefinition[];

const ddlFor = (dialect: "postgresql" | "mysql" | "sqlite"): string =>
  new DynamicCollectionSchemaService(undefined, dialect).generateMigrationSQL(
    "dc_pinned",
    declaredSlug,
    { hasStatus: false }
  );

describe("a declared slug field", () => {
  it("is bounded on MySQL, where the index needs it to be", () => {
    const sql = ddlFor("mysql");

    // The column and the index that requires it, asserted together: either alone would still pass
    // if the generator stopped emitting the other.
    expect(sql).toMatch(/`slug`\s+varchar\(\d+\)/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX .*`slug`/i);
    // The type MySQL cannot index. Named explicitly because it is what the service's own map
    // returns, so this is the value the column falls back to when the canonical lookup is skipped.
    expect(sql).not.toMatch(/`slug`\s+text/i);
  });

  // The other two dialects index a text column happily, so they keep `text` rather than being
  // pulled toward MySQL's constraint. Pinned so a fix for MySQL cannot widen every dialect's slug
  // column as a side effect.
  it("keeps the type the other dialects already index", () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const sql = ddlFor(dialect);
      expect(sql).toMatch(/"slug"\s+text/i);
      expect(sql).toMatch(/CREATE UNIQUE INDEX .*"slug"/i);
    }
  });

  /**
   * The repair path has to agree with the create path about this column.
   *
   * A table that predates the synthetic identity columns gets its `slug` ADDed rather than created,
   * and that path never reaches the generator above. Bounded there and unbounded here, the same
   * entity ends up with a column MySQL will not index, and every later diff reports a type change
   * on a column nothing touched.
   *
   * Asserted for the builders that carry a slug identity column, because the reason it is bounded
   * — the unique index on it — does not depend on which of those made the table. A field group has
   * no such column and indexes its parent pointer instead, so it is excluded here and covered by
   * the descriptor's own suite.
   */
  it("adds the same bounded column to a table that already exists", () => {
    const slugField = { name: "slug", type: "text" } as unknown as FieldConfig;

    for (const builtBy of ["collection", "codeFirst"] as const) {
      expect(fieldToColumnDef(slugField, "mysql", builtBy)).toMatch(
        /VARCHAR\(\d+\)/i
      );
      expect(fieldToColumnDef(slugField, "mysql", builtBy)).not.toMatch(
        /\bTEXT\b/i
      );
    }
  });

  // The mirror, so the exclusion is asserted rather than merely omitted: a field group's own slug
  // field keeps the unbounded column its creator makes.
  it("leaves a field group's slug field alone", () => {
    const slugField = { name: "slug", type: "text" } as unknown as FieldConfig;

    expect(fieldToColumnDef(slugField, "mysql", "fieldGroup")).toMatch(
      /\bTEXT\b/i
    );
  });
});
