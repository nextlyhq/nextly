import { describe, expect, it } from "vitest";

import { buildDesiredTableFromFields } from "../build-from-fields.js";

// Minimal FieldConfig shape used by the helper. The real type lives in
// schemas/dynamic-collections/types.ts and has many more attrs; we only
// need name + type + required for diffing.
interface MinimalField {
  name: string;
  type: string;
  required?: boolean;
}

describe("buildDesiredTableFromFields - postgresql", () => {
  it("maps text fields to PG text type token", () => {
    const fields: MinimalField[] = [
      { name: "title", type: "text", required: true },
      { name: "summary", type: "text" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(table.name).toBe("dc_posts");
    expect(table.columns).toEqual([
      { name: "title", type: "text", nullable: false, default: undefined },
      { name: "summary", type: "text", nullable: true, default: undefined },
    ]);
  });

  it("maps number fields to float8 (introspection udt_name for double precision)", () => {
    const fields: MinimalField[] = [{ name: "price", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "postgresql"
    );

    expect(table.columns[0]).toEqual({
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

    expect(table.columns[0].type).toBe("bool");
  });

  it("maps date fields to timestamp (PG udt_name)", () => {
    const fields: MinimalField[] = [{ name: "published_at", type: "date" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(table.columns[0].type).toBe("timestamp");
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

    expect(table.columns[0].type).toBe("jsonb");
    expect(table.columns[1].type).toBe("jsonb");
    expect(table.columns[2].type).toBe("jsonb");
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

    expect(table.columns.map(c => c.name)).toEqual(["published_at", "user_id"]);
  });

  it("skips layout-only field types (no DB column)", () => {
    const fields: MinimalField[] = [
      { name: "row1", type: "row" },
      { name: "tab1", type: "tabs" },
      { name: "title", type: "text" },
    ];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "postgresql"
    );

    expect(table.columns).toHaveLength(1);
    expect(table.columns[0].name).toBe("title");
  });
});

describe("buildDesiredTableFromFields - mysql", () => {
  it("maps text fields to varchar(255) (matches mysql COLUMN_TYPE format)", () => {
    const fields: MinimalField[] = [{ name: "title", type: "text" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(table.columns[0].type).toBe("varchar(255)");
  });

  it("maps textarea fields to text (longer content)", () => {
    const fields: MinimalField[] = [{ name: "body", type: "textarea" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(table.columns[0].type).toBe("text");
  });

  it("maps checkbox fields to tinyint(1) (mysql boolean alias)", () => {
    const fields: MinimalField[] = [{ name: "is_pub", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(table.columns[0].type).toBe("tinyint(1)");
  });

  it("maps number fields to double", () => {
    const fields: MinimalField[] = [{ name: "price", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "mysql"
    );

    expect(table.columns[0].type).toBe("double");
  });

  it("maps json/blocks/group fields to json", () => {
    const fields: MinimalField[] = [{ name: "meta", type: "json" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "mysql"
    );

    expect(table.columns[0].type).toBe("json");
  });
});

describe("buildDesiredTableFromFields - sqlite", () => {
  it("maps text fields to TEXT", () => {
    const fields: MinimalField[] = [{ name: "title", type: "text" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
    );

    expect(table.columns[0].type).toBe("TEXT");
  });

  it("maps number fields to REAL", () => {
    const fields: MinimalField[] = [{ name: "price", type: "number" }];

    const table = buildDesiredTableFromFields(
      "dc_products",
      fields as never,
      "sqlite"
    );

    expect(table.columns[0].type).toBe("REAL");
  });

  it("maps checkbox fields to INTEGER (no native bool)", () => {
    const fields: MinimalField[] = [{ name: "is_pub", type: "checkbox" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
    );

    expect(table.columns[0].type).toBe("INTEGER");
  });

  it("maps date fields to INTEGER (epoch convention)", () => {
    const fields: MinimalField[] = [{ name: "ts", type: "date" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
    );

    expect(table.columns[0].type).toBe("INTEGER");
  });

  it("maps json/blocks/group fields to TEXT (no native json)", () => {
    const fields: MinimalField[] = [{ name: "meta", type: "json" }];

    const table = buildDesiredTableFromFields(
      "dc_posts",
      fields as never,
      "sqlite"
    );

    expect(table.columns[0].type).toBe("TEXT");
  });
});
