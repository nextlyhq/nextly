import { describe, expect, it } from "vitest";

import { getColumnDescriptor } from "../../../services/field-column-descriptor";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "../build-from-fields";
import type { ColumnSpec } from "../types";

// Characterization test guarding the ui-schema widening: every field type now
// allowed in ui-schema.json must already map to a column via the descriptor
// (so the manifest round-trips with no translation). If any of these FAIL, that
// type isn't actually storable and must be removed from UI_FIELD_TYPES.
describe("canonical field types map to columns (widened ui-schema set)", () => {
  const cases: Array<[string, string]> = [
    ["email", "text"],
    ["password", "text"],
    ["code", "text"],
    ["radio", "text"],
    ["repeater", "jsonb"],
    ["group", "jsonb"],
    ["json", "jsonb"],
    ["chips", "jsonb"],
  ];
  for (const [type, dialectType] of cases) {
    it(`maps ${type} -> ${dialectType} (postgres)`, () => {
      const d = getColumnDescriptor(
        { name: "f", type, required: false } as unknown as Parameters<
          typeof getColumnDescriptor
        >[0],
        "postgresql",
        "codeFirst"
      );
      expect(d?.dialectType).toBe(dialectType);
    });
  }

  // component is storable but has no parent column: its values live in a
  // separate comp_{slug} table, so the descriptor returns null (column-less).
  it("maps component -> no parent column (stored in its own table)", () => {
    const d = getColumnDescriptor(
      { name: "f", type: "component", required: true } as unknown as Parameters<
        typeof getColumnDescriptor
      >[0],
      "postgresql",
      "codeFirst"
    );
    expect(d).toBeNull();
  });
});

// Minimal FieldConfig shape used by the helper. The real type lives in
// schemas/dynamic-collections/types.ts; we only need name + type + required.
interface MinimalField {
  name: string;
  type: string;
  required?: boolean;
}

const RESERVED_NAMES = new Set([
  "id",
  "title",
  "slug",
  "created_at",
  "updated_at",
  "created_by",
]);

function userColumns(columns: ColumnSpec[]): ColumnSpec[] {
  return columns.filter(c => !RESERVED_NAMES.has(c.name));
}

function findColumn(
  columns: ColumnSpec[],
  name: string
): ColumnSpec | undefined {
  return columns.find(c => c.name === name);
}

describe("buildDesiredTableFromFields - reserved columns", () => {
  it("PG: injects id + created_at + updated_at + title + slug + created_by", () => {
    const table = buildDesiredTableFromFields("dc_x", [], "postgresql", {
      builtBy: "codeFirst",
    });
    expect(findColumn(table.columns, "id")).toEqual({
      name: "id",
      type: "text",
      nullable: false,
      default: undefined,
      // Carried through from the column descriptor. The diff exempts primary
      // keys from the nullability comparison, and a desired `id` that arrives
      // without this marker takes no exemption — which on SQLite means every
      // Schema-Builder table keeps proposing a nullability change no ALTER
      // there can make.
      primaryKey: true,
    });
    expect(findColumn(table.columns, "title")).toEqual({
      name: "title",
      type: "text",
      nullable: false,
    });
    expect(findColumn(table.columns, "slug")).toEqual({
      name: "slug",
      type: "text",
      nullable: false,
    });
    expect(findColumn(table.columns, "created_at")?.type).toBe("timestamp");
    expect(findColumn(table.columns, "updated_at")?.type).toBe("timestamp");
    // Owner column: nullable text (matches the id column type), no default.
    expect(findColumn(table.columns, "created_by")).toEqual({
      name: "created_by",
      type: "text",
      nullable: true,
    });
  });

  it("keeps the system title column when a component field is named 'title'", () => {
    // A component provides no column, so it must not suppress the system title
    // column the way a real user 'title' field does.
    const table = buildDesiredTableFromFields(
      "dc_x",
      [{ name: "title", type: "component" }] as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );
    expect(findColumn(table.columns, "title")).toEqual({
      name: "title",
      type: "text",
      nullable: false,
    });
  });

  it("MySQL: id is varchar(36); title/slug varchar(255); timestamps", () => {
    const table = buildDesiredTableFromFields("dc_x", [], "mysql", {
      builtBy: "codeFirst",
    });
    expect(findColumn(table.columns, "id")?.type).toBe("varchar(36)");
    expect(findColumn(table.columns, "title")?.type).toBe("varchar(255)");
    expect(findColumn(table.columns, "slug")?.type).toBe("varchar(255)");
    expect(findColumn(table.columns, "created_at")?.type).toBe("timestamp");
  });

  it("SQLite: lowercase tokens (matches PRAGMA-as-declared)", () => {
    const table = buildDesiredTableFromFields("dc_x", [], "sqlite", {
      builtBy: "codeFirst",
    });
    expect(findColumn(table.columns, "id")?.type).toBe("text");
    expect(findColumn(table.columns, "title")?.type).toBe("text");
    expect(findColumn(table.columns, "created_at")?.type).toBe("integer");
  });

  it("user-defined `title` field replaces the auto-injected reserved `title`", () => {
    const fields: MinimalField[] = [
      { name: "title", type: "textarea", required: true },
    ];
    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    // exactly one `title` - the user's field shape, not the reserved.
    const titles = table.columns.filter(c => c.name === "title");
    expect(titles).toHaveLength(1);
    expect(titles[0].type).toBe("text"); // textarea -> pgText
    expect(titles[0].nullable).toBe(false); // user marked required
  });

  it("user-defined `slug` field replaces the auto-injected reserved `slug`", () => {
    const fields: MinimalField[] = [{ name: "slug", type: "text" }];
    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    const slugs = table.columns.filter(c => c.name === "slug");
    expect(slugs).toHaveLength(1);
    expect(slugs[0].nullable).toBe(true); // user did NOT mark required
  });
});

describe("buildDesiredTableFromFields - postgresql user fields", () => {
  it("maps text fields to PG text type token", () => {
    const fields: MinimalField[] = [
      { name: "summary", type: "text", required: true },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(userColumns(table.columns)).toEqual([
      { name: "summary", type: "text", nullable: false, default: undefined },
    ]);
  });

  it("maps number fields to float8 (introspection udt_name for double precision)", () => {
    // A number field only takes float storage when it asks for it:
    // `options.format === "float"` is what the UI sets, and code-first can also
    // opt in with `dbType: "decimal"`. The spelling is the point of this test --
    // `float8` is what PostgreSQL introspection reports as udt_name, so the
    // DESIRED table has to say `float8` too, or every diff would see a phantom
    // type change against a column that is already correct.
    const fields: MinimalField[] = [
      { name: "price", type: "number", options: { format: "float" } },
    ];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "price")).toEqual({
      name: "price",
      type: "float8",
      nullable: true,
      default: undefined,
    });
  });

  it("maps a code-first number with no format to int4, not to a float", () => {
    // The default this file previously assumed away. A code-first number
    // without `dbType` or `options.format` is an INTEGER, which
    // field-column-descriptor states is deliberate: it matches the DDL
    // dynamic-collection-schema-service emits. Asserted here because the two
    // must agree -- if the desired table said float8 while the DDL wrote int4,
    // the diff would try to "fix" every such column on every push.
    const fields: MinimalField[] = [{ name: "qty", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "qty")?.type).toBe("int4");
  });

  it("maps checkbox fields to bool (introspection udt_name)", () => {
    const fields: MinimalField[] = [{ name: "is_published", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "is_published")?.type).toBe("bool");
  });

  it("maps date fields to timestamp (PG udt_name)", () => {
    const fields: MinimalField[] = [{ name: "published_at", type: "date" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "published_at")?.type).toBe("timestamp");
  });

  it("maps json/repeater/group fields to jsonb", () => {
    const fields: MinimalField[] = [
      { name: "tags", type: "chips" },
      { name: "meta", type: "json" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "tags")?.type).toBe("jsonb");
    expect(findColumn(table.columns, "meta")?.type).toBe("jsonb");
  });

  it("converts field names to snake_case (matches DDL convention)", () => {
    const fields: MinimalField[] = [
      { name: "publishedAt", type: "date" },
      { name: "userId", type: "text" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(userColumns(table.columns).map(c => c.name)).toEqual([
      "published_at",
      "user_id",
    ]);
  });

  it("skips the field types whose values live in another table", () => {
    // This replaces an assertion about "layout-only" types `row` and `tabs`.
    // Neither exists: grep finds no such field type outside that test, and the
    // two LAYOUT_FIELD_TYPES collections meant to name them are empty and
    // unreachable (finding:layout-field-type-sets-are-empty-and-dead). The old
    // test therefore asserted the OPPOSITE of a deliberate rule --
    // `fieldProducesColumn` documents that an unrecognised type counts as a
    // column, "so a field type whose plugin has not registered yet is still
    // held to the rules that columns carry rather than quietly escaping them."
    //
    // The rule it was reaching for is real, so it is asserted here through the
    // mechanisms that actually implement it: a component keeps its values in
    // its own comp_{slug} table, and a many-to-many relationship keeps its
    // links in a junction table. Neither needs a column on the parent row.
    const fields: MinimalField[] = [
      { name: "hero", type: "component" },
      {
        name: "tags",
        type: "relationship",
        options: { relationType: "manyToMany" },
      },
      { name: "summary", type: "text" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(userColumns(table.columns)).toHaveLength(1);
    expect(userColumns(table.columns)[0].name).toBe("summary");
  });

  it("gives an UNRECOGNISED field type a column rather than dropping it", () => {
    // The other half of that rule, and the reason the two cannot be collapsed:
    // silently emitting no column for a type nobody recognises would let an
    // unregistered plugin field escape every constraint a column carries. The
    // documented choice is to treat it as text.
    const fields: MinimalField[] = [
      { name: "mystery", type: "not-a-registered-type" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );

    expect(userColumns(table.columns).map(c => c.name)).toEqual(["mystery"]);
  });
});

describe("buildDesiredTableFromFields - mysql user fields", () => {
  it("maps text fields to varchar(255) (matches mysql COLUMN_TYPE format)", () => {
    const fields: MinimalField[] = [{ name: "summary", type: "text" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "summary")?.type).toBe("varchar(255)");
  });

  it("maps textarea fields to text (longer content)", () => {
    const fields: MinimalField[] = [{ name: "body", type: "textarea" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "body")?.type).toBe("text");
  });

  it("maps checkbox fields to tinyint(1) (mysql boolean alias)", () => {
    const fields: MinimalField[] = [{ name: "is_pub", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "is_pub")?.type).toBe("tinyint(1)");
  });

  it("maps number fields to double", () => {
    // Float storage is opt-in — see the postgresql case above.
    const fields: MinimalField[] = [
      { name: "price", type: "number", options: { format: "float" } },
    ];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "mysql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "price")?.type).toBe("double");
  });

  it("maps json/group fields to json", () => {
    const fields: MinimalField[] = [{ name: "meta", type: "json" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "meta")?.type).toBe("json");
  });

  it("relationship/upload fields use varchar(36) (matches runtime FK-to-UUID-id width)", () => {
    const fields: MinimalField[] = [
      { name: "author_id", type: "relationship" },
      { name: "cover", type: "upload" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "author_id")?.type).toBe("varchar(36)");
    expect(findColumn(table.columns, "cover")?.type).toBe("varchar(36)");
  });
});

describe("buildDesiredTableFromFields - sqlite user fields", () => {
  it("maps text fields to lowercase 'text' (matches drizzle's emitted DDL + PRAGMA)", () => {
    const fields: MinimalField[] = [{ name: "summary", type: "text" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "summary")?.type).toBe("text");
  });

  it("maps number fields to lowercase 'real'", () => {
    // Float storage is opt-in — see the postgresql case above.
    const fields: MinimalField[] = [
      { name: "price", type: "number", options: { format: "float" } },
    ];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "sqlite",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "price")?.type).toBe("real");
  });

  it("maps checkbox fields to lowercase 'integer' (no native bool)", () => {
    const fields: MinimalField[] = [{ name: "is_pub", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "is_pub")?.type).toBe("integer");
  });

  it("maps date fields to lowercase 'integer' (epoch convention)", () => {
    const fields: MinimalField[] = [{ name: "ts", type: "date" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "ts")?.type).toBe("integer");
  });

  it("maps json/group fields to lowercase 'text' (no native json)", () => {
    const fields: MinimalField[] = [{ name: "meta", type: "json" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite",
      { builtBy: "codeFirst" }
    );

    expect(findColumn(table.columns, "meta")?.type).toBe("text");
  });
});

// Why: status (Draft/Published) is opt-in per collection/single. The diff
// must include a status system column when hasStatus is true so the pipeline
// adds it on first enable and drops it on disable. These tests lock the
// dialect-specific introspection-aligned types.
describe("buildDesiredTableFromFields with status enabled", () => {
  it("adds a status column with PG dialect type 'varchar' (matches runtime DDL)", () => {
    // Must mirror runtime-schema-generator's
    // `pgVarchar("status",{length:20}).notNull().default("draft")`.
    // PG's information_schema.columns.udt_name returns "varchar" for that
    // column, so the descriptor must emit "varchar" too — otherwise the
    // diff reports a phantom change_column_type (varchar → text) on every
    // apply and the fast-path emitter is bypassed.
    const table = buildDesiredTableFromFields(
      "dc_posts",
      [] as never,
      "postgresql",
      { builtBy: "codeFirst", hasStatus: true }
    );
    const status = findColumn(table.columns, "status");
    expect(status).toBeDefined();
    expect(status?.type).toBe("varchar");
    expect(status?.nullable).toBe(false);
    expect(status?.default).toBe("'draft'");
  });

  it("adds a status column with MySQL dialect type 'varchar(20)'", () => {
    const table = buildDesiredTableFromFields(
      "dc_posts",
      [] as never,
      "mysql",
      { builtBy: "codeFirst", hasStatus: true }
    );
    const status = findColumn(table.columns, "status");
    expect(status?.type).toBe("varchar(20)");
    expect(status?.nullable).toBe(false);
    expect(status?.default).toBe("'draft'");
  });

  it("adds a status column with SQLite dialect type 'text'", () => {
    const table = buildDesiredTableFromFields(
      "dc_posts",
      [] as never,
      "sqlite",
      { builtBy: "codeFirst", hasStatus: true }
    );
    const status = findColumn(table.columns, "status");
    expect(status?.type).toBe("text");
    expect(status?.nullable).toBe(false);
    expect(status?.default).toBe("'draft'");
  });

  it("omits the status column when hasStatus is false or unset", () => {
    const tableUnset = buildDesiredTableFromFields(
      "dc_posts",
      [] as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );
    expect(findColumn(tableUnset.columns, "status")).toBeUndefined();

    const tableFalse = buildDesiredTableFromFields(
      "dc_posts",
      [] as never,
      "postgresql",
      { builtBy: "codeFirst", hasStatus: false }
    );
    expect(findColumn(tableFalse.columns, "status")).toBeUndefined();
  });
});

describe("buildDesiredTableFromComponentFields - per-field indexes", () => {
  // FieldGroupSchemaService creates idx_<table>_<column> for an indexed field
  // and uq_<table>_<column> for a unique one. The snapshot has to carry them
  // too: it is what the index restore replays after a SQLite rebuild, and a
  // unique index missing from it is a constraint that silently disappears.
  const fields = [
    { name: "title", type: "text" },
    { name: "sku", type: "text", unique: true },
    { name: "lookupKey", type: "text", index: true },
  ] as unknown as Parameters<typeof buildDesiredTableFromComponentFields>[1];

  it("records a unique field's index", () => {
    const table = buildDesiredTableFromComponentFields(
      "comp_hero",
      fields,
      "sqlite",
      { builtBy: "codeFirst" }
    );
    expect(table.indexes).toContainEqual({
      name: "uq_comp_hero_sku",
      columns: ["sku"],
      unique: true,
    });
  });

  it("records an indexed field's index", () => {
    const table = buildDesiredTableFromComponentFields(
      "comp_hero",
      fields,
      "sqlite",
      { builtBy: "codeFirst" }
    );
    expect(table.indexes).toContainEqual({
      name: "idx_comp_hero_lookup_key",
      columns: ["lookup_key"],
      unique: false,
    });
  });

  it("still records the parent index", () => {
    const table = buildDesiredTableFromComponentFields(
      "comp_hero",
      fields,
      "sqlite",
      { builtBy: "codeFirst" }
    );
    expect(table.indexes?.map(i => i.name)).toContain("idx_comp_hero_parent");
  });
});

describe("owner index", () => {
  // The collection service creates idx_<table>_created_by for every table with
  // the owner column, and owner-scoped reads filter on it. A SQLite rebuild
  // drops every index the replacement table does not declare, and the restore
  // replays only what the snapshot carries — so it has to be recorded here.
  it("is recorded for a collection", () => {
    const table = buildDesiredTableFromFields("dc_posts", [], "sqlite", {
      builtBy: "codeFirst",
    });
    expect(table.indexes).toContainEqual({
      name: "idx_dc_posts_created_by",
      columns: ["created_by"],
      unique: false,
    });
  });

  it("is not recorded for a component, which has no owner column", () => {
    const table = buildDesiredTableFromComponentFields(
      "comp_hero",
      [],
      "sqlite",
      { builtBy: "codeFirst" }
    );
    expect(table.indexes?.map(i => i.name)).not.toContain(
      "idx_comp_hero_created_by"
    );
  });
});

/**
 * 🔴 The discriminator is a SYSTEM column, so its name is never a preference.
 *
 * The only two spellings are the two storage generations, and which one a table
 * carries is a fact about that table. A desired shape that names the other one
 * turns the diff into "add this column, drop that one" — a destructive pair the
 * classifier refuses and fresh-push strips, so the operation never applies and
 * never goes away, and every later apply carries it.
 */
describe("buildDesiredTableFromComponentFields - the discriminator column", () => {
  const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;
  const noFields = [] as unknown as Parameters<
    typeof buildDesiredTableFromComponentFields
  >[1];

  describe.each(DIALECTS)("%s", dialect => {
    it("writes the spelling this release's DDL creates by default", () => {
      const names = buildDesiredTableFromComponentFields(
        "comp_hero",
        noFields,
        dialect,
        { builtBy: "codeFirst" }
      ).columns.map(column => column.name);

      expect(names).toContain("_component_type");
      expect(names).not.toContain("_field_group_type");
    });

    // Both halves matter: naming the migrated column is not enough on its own,
    // because leaving the legacy one in the desired shape is what emits the ADD.
    it("writes the migrated spelling when the table carries it", () => {
      const names = buildDesiredTableFromComponentFields(
        "fg_hero",
        noFields,
        dialect,
        { builtBy: "codeFirst", typeColumn: "_field_group_type" }
      ).columns.map(column => column.name);

      expect(names).toContain("_field_group_type");
      expect(names).not.toContain("_component_type");
    });
  });
});
