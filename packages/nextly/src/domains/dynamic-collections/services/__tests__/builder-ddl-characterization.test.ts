/**
 * What the Schema Builder's DDL generators emit, recorded exactly.
 *
 * These assert nothing about what the SQL *should* be. They record what it *is*, so that a change
 * which is meant to leave the emitted DDL alone can be shown to have done so rather than assumed to.
 *
 * Scope, stated precisely so it is not mistaken for more than it is: these call the generators
 * directly with the options spelled out, so they pin what each generator RENDERS for a given set of
 * options. They do not pin what any caller PASSES — a caller that stops forwarding `localized`,
 * `hasStatus` or `isSingle` still reaches these assertions with the options hard-coded correctly and
 * they still pass. Covering that belongs with whichever entry point assembles the options, asserted
 * from a request payload rather than from an options object.
 *
 * Whole strings rather than substrings, on purpose: the failure worth catching is a column quietly
 * changing type, losing NOT NULL, or gaining a default, and a substring assertion sees none of those.
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
/**
 * A field of every shape these generators treat differently: free text, a bounded string, a whole
 * number, a fractional number, a boolean, a date, structured data, and the two column-level
 * constraints the Builder can set.
 *
 * The two generators read a declared width from different places — this one from
 * `options.variant` plus `validation.maxLength`, the field-group one from a top-level `maxLength` —
 * so a bounded column needs a fixture per generator or the `VARCHAR(n)` branch goes unrecorded.
 */
const FIELDS: FieldDefinition[] = [
  {
    name: "title",
    type: "text",
    required: true,
    validation: { minLength: 3, regex: "^[A-Za-z0-9 ]+$" },
  },
  { name: "slugKey", type: "text", unique: true },
  {
    name: "shortCode",
    type: "text",
    options: { variant: "short" },
    validation: { maxLength: 120 },
  },
  { name: "summary", type: "textarea" },
  // Each of these reaches a different CHECK branch: numeric bounds, a minimum length, and the
  // dialect-specific regex operator. `maxLength` alone never gets there — it only selects a width.
  {
    name: "views",
    type: "number",
    validation: { min: 0, max: 10000 },
  },
  { name: "rating", type: "number", options: { format: "float" } },
  { name: "published", type: "checkbox" },
  { name: "publishedAt", type: "date" },
  { name: "payload", type: "json" },
  { name: "lookupCode", type: "text", index: true },
  // A relationship renders differently from every primitive above: its own column type, its own
  // index, and on this generator a foreign key with delete and update actions. It reads the target
  // from `options.target`, where the field-group generator reads `relationTo`.
  {
    name: "author",
    type: "relationship",
    options: { target: "authors", onDelete: "cascade", onUpdate: "cascade" },
  },
  {
    name: "editors",
    type: "relationship",
    relationTo: "authors",
    hasMany: true,
  },
  // Only `options.relationType: "manyToMany"` reaches this generator's junction branch, which emits
  // a whole table of its own with its own columns, constraints and index names.
  {
    name: "tags",
    type: "relationship",
    options: { target: "tags", relationType: "manyToMany" },
  },
  // A default the author sets, rendered by the generator rather than injected as a system default
  // like the timestamps are — nothing else in this fixture reaches that branch.
  { name: "state", type: "text", default: "draft" },
  // Structured containers. The two generators disagree about these today: this one has no mapping
  // entry for either and falls back to text, while the field-group generator renders the dialect's
  // JSON type. Routing one through the other's mapping would change what is persisted.
  { name: "blocks", type: "repeater" },
  { name: "meta", type: "group" },
];

/** The same shapes, with the width stated the way the field-group generator reads it. */
const FIELD_GROUP_FIELDS = FIELDS.map(field => {
  if (field.name === "shortCode") {
    return { name: "shortCode", type: "text", maxLength: 120 };
  }
  // This generator reads a relationship's target from `relationTo`, and renders a single-target
  // relationship differently from a hasMany one.
  if (field.name === "author") {
    return { name: "author", type: "relationship", relationTo: "authors" };
  }
  // A junction is a collection-generator concept; a field group stores the same relationship as a
  // scalar column, so this states it the way that generator reads it.
  if (field.name === "tags") {
    return { name: "tags", type: "relationship", relationTo: "tags" };
  }
  // This generator reads a default from `defaultValue`, and renders one only for a checkbox.
  if (field.name === "state") {
    return { name: "state", type: "checkbox", defaultValue: true };
  }
  return field;
});

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

    // A localized entity keeps its translatable columns in the companion `_locales` table, so the
    // main CREATE must omit them. Emitting them on main instead leaves two homes for one value and
    // the companion holding nothing.
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
    // A field group's table carries its own system columns — parent linkage, ordering, and the type
    // discriminator — rather than a collection's, and a separate generator renders them. Its output
    // is recorded for the same reason and to the same depth.
    it("emits the same CREATE for a field group", () => {
      const generate = () =>
        new FieldGroupSchemaService(dialect).generateMigrationSQL(
          "comp_pinned",
          FIELD_GROUP_FIELDS as unknown as FieldConfig[]
        );

      // The fixture carries a unique unbounded text field. A component's uniqueness is a
      // SEPARATE `CREATE UNIQUE INDEX`, not an inline constraint, so on MySQL — which can key
      // neither spelling of TEXT — the table would be created and then the index rejected,
      // leaving a component without the guarantee it declared. There is no DDL to pin for that
      // combination; the honest output is a refusal, so that is what is recorded.
      if (dialect === "mysql") {
        expect(generate).toThrow(/Validation failed/);
        return;
      }

      expect(generate().trim()).toMatchSnapshot();
    });

    it("emits the same CREATE for a localized field group", () => {
      const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
        "comp_pinned",
        FIELD_GROUP_FIELDS as unknown as FieldConfig[],
        { localized: true }
      );

      expect(sql.trim()).toMatchSnapshot();
    });
  });
});
