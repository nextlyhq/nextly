import { describe, expect, it } from "vitest";

import { getColumnDescriptor } from "../../../services/field-column-descriptor";
import { buildDesiredTableFromFields } from "../build-from-fields";
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
        "postgresql"
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
      "postgresql"
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
  it("PG: injects id + created_at + updated_at + title + slug", () => {
    const table = buildDesiredTableFromFields("dc_x", [], "postgresql");
    expect(findColumn(table.columns, "id")).toEqual({
      name: "id",
      type: "text",
      nullable: false,
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
  });

  it("keeps the system title column when a component field is named 'title'", () => {
    // A component provides no column, so it must not suppress the system title
    // column the way a real user 'title' field does.
    const table = buildDesiredTableFromFields(
      "dc_x",
      [{ name: "title", type: "component" }] as never,
      "postgresql"
    );
    expect(findColumn(table.columns, "title")).toEqual({
      name: "title",
      type: "text",
      nullable: false,
    });
  });

  it("MySQL: id is varchar(36); title/slug varchar(255); timestamps", () => {
    const table = buildDesiredTableFromFields("dc_x", [], "mysql");
    expect(findColumn(table.columns, "id")?.type).toBe("varchar(36)");
    expect(findColumn(table.columns, "title")?.type).toBe("varchar(255)");
    expect(findColumn(table.columns, "slug")?.type).toBe("varchar(255)");
    expect(findColumn(table.columns, "created_at")?.type).toBe("timestamp");
  });

  it("SQLite: lowercase tokens (matches PRAGMA-as-declared)", () => {
    const table = buildDesiredTableFromFields("dc_x", [], "sqlite");
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
      "postgresql"
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
      "postgresql"
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
      "postgresql"
    );

    expect(userColumns(table.columns)).toEqual([
      { name: "summary", type: "text", nullable: false, default: undefined },
    ]);
  });

  it("maps number fields to float8 (introspection udt_name for double precision)", () => {
    const fields: MinimalField[] = [{ name: "price", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "postgresql"
    );

    expect(findColumn(table.columns, "price")).toEqual({
      name: "price",
      type: "float8",
      nullable: true,
      default: undefined,
    });
  });

  it("maps checkbox fields to bool (introspection udt_name)", () => {
    const fields: MinimalField[] = [{ name: "is_published", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(findColumn(table.columns, "is_published")?.type).toBe("bool");
  });

  it("maps date fields to timestamp (PG udt_name)", () => {
    const fields: MinimalField[] = [{ name: "published_at", type: "date" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(findColumn(table.columns, "published_at")?.type).toBe("timestamp");
  });

  it("maps json/repeater/group/blocks fields to jsonb", () => {
    const fields: MinimalField[] = [
      { name: "tags", type: "chips" },
      { name: "blocks_field", type: "blocks" },
      { name: "meta", type: "json" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(findColumn(table.columns, "tags")?.type).toBe("jsonb");
    expect(findColumn(table.columns, "blocks_field")?.type).toBe("jsonb");
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
      "postgresql"
    );

    expect(userColumns(table.columns).map(c => c.name)).toEqual([
      "published_at",
      "user_id",
    ]);
  });

  it("skips layout-only field types (no DB column)", () => {
    const fields: MinimalField[] = [
      { name: "row1", type: "row" },
      { name: "tab1", type: "tabs" },
      { name: "summary", type: "text" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(userColumns(table.columns)).toHaveLength(1);
    expect(userColumns(table.columns)[0].name).toBe("summary");
  });
});

describe("buildDesiredTableFromFields - mysql user fields", () => {
  it("maps text fields to varchar(255) (matches mysql COLUMN_TYPE format)", () => {
    const fields: MinimalField[] = [{ name: "summary", type: "text" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(findColumn(table.columns, "summary")?.type).toBe("varchar(255)");
  });

  it("maps textarea fields to text (longer content)", () => {
    const fields: MinimalField[] = [{ name: "body", type: "textarea" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(findColumn(table.columns, "body")?.type).toBe("text");
  });

  it("maps checkbox fields to tinyint(1) (mysql boolean alias)", () => {
    const fields: MinimalField[] = [{ name: "is_pub", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(findColumn(table.columns, "is_pub")?.type).toBe("tinyint(1)");
  });

  it("maps number fields to double", () => {
    const fields: MinimalField[] = [{ name: "price", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "mysql"
    );

    expect(findColumn(table.columns, "price")?.type).toBe("double");
  });

  it("maps json/blocks/group fields to json", () => {
    const fields: MinimalField[] = [{ name: "meta", type: "json" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
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
      "mysql"
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
      "sqlite"
    );

    expect(findColumn(table.columns, "summary")?.type).toBe("text");
  });

  it("maps number fields to lowercase 'real'", () => {
    const fields: MinimalField[] = [{ name: "price", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "sqlite"
    );

    expect(findColumn(table.columns, "price")?.type).toBe("real");
  });

  it("maps checkbox fields to lowercase 'integer' (no native bool)", () => {
    const fields: MinimalField[] = [{ name: "is_pub", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
    );

    expect(findColumn(table.columns, "is_pub")?.type).toBe("integer");
  });

  it("maps date fields to lowercase 'integer' (epoch convention)", () => {
    const fields: MinimalField[] = [{ name: "ts", type: "date" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
    );

    expect(findColumn(table.columns, "ts")?.type).toBe("integer");
  });

  it("maps json/blocks/group fields to lowercase 'text' (no native json)", () => {
    const fields: MinimalField[] = [{ name: "meta", type: "json" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
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
      { hasStatus: true }
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
      { hasStatus: true }
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
      { hasStatus: true }
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
      "postgresql"
    );
    expect(findColumn(tableUnset.columns, "status")).toBeUndefined();

    const tableFalse = buildDesiredTableFromFields(
      "dc_posts",
      [] as never,
      "postgresql",
      { hasStatus: false }
    );
    expect(findColumn(tableFalse.columns, "status")).toBeUndefined();
  });
});
