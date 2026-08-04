import { describe, it, expect } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { getColumnDescriptor } from "../../schema/services/field-column-descriptor";

import { ddlType, q, castText } from "./ddl-types";
import { fieldToLocalizedColumnSpec } from "./field-to-column-spec";
import type { LocalizedColumnSpec } from "./types";

describe("ddlType", () => {
  it("maps text per dialect", () => {
    expect(ddlType({ name: "title", kind: "text" }, "postgresql")).toBe("TEXT");
    expect(ddlType({ name: "title", kind: "text" }, "mysql")).toBe(
      "VARCHAR(255)"
    );
    expect(ddlType({ name: "title", kind: "text" }, "sqlite")).toBe("TEXT");
  });

  it("maps json/boolean/double for postgres", () => {
    expect(ddlType({ name: "c", kind: "json" }, "postgresql")).toBe("JSONB");
    expect(ddlType({ name: "b", kind: "boolean" }, "postgresql")).toBe(
      "BOOLEAN"
    );
    expect(ddlType({ name: "d", kind: "double" }, "postgresql")).toBe(
      "DOUBLE PRECISION"
    );
  });

  it("honors varchar length override on mysql", () => {
    expect(ddlType({ name: "s", kind: "text", length: 64 }, "mysql")).toBe(
      "VARCHAR(64)"
    );
  });
});

describe("q (identifier quoting)", () => {
  it("uses double quotes for pg/sqlite and backticks for mysql", () => {
    expect(q("dc_pages", "postgresql")).toBe('"dc_pages"');
    expect(q("dc_pages", "sqlite")).toBe('"dc_pages"');
    expect(q("dc_pages", "mysql")).toBe("`dc_pages`");
  });
});

describe("castText", () => {
  it("casts to CHAR on mysql, TEXT elsewhere", () => {
    expect(castText('"title"', "mysql")).toBe('CAST("title" AS CHAR)');
    expect(castText('"title"', "postgresql")).toBe('CAST("title" AS TEXT)');
    expect(castText('"title"', "sqlite")).toBe('CAST("title" AS TEXT)');
  });
});

/**
 * A companion column is the same type as the one it mirrors on the main table.
 *
 * These two renderers describe the same logical kind for two halves of one entity: this one writes
 * the companion's DDL, the canonical descriptor describes the main table and is what the ORM binds.
 * They disagreed on MySQL for every kind that lands on `longText` — LONGTEXT here, ordinary TEXT
 * there and in the creator — and `longtext` and `text` do not normalise to each other, so the diff
 * reported a type change on a column nothing had touched.
 */
describe("companion DDL agrees with the canonical descriptor", () => {
  const textish = [
    { name: "body", type: "textarea" },
    { name: "story", type: "richText" },
    { name: "snippet", type: "code" },
  ] as unknown as FieldDefinition[];

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "renders a long text column the same way on %s",
    dialect => {
      for (const field of textish) {
        const spec = fieldToLocalizedColumnSpec(field, dialect, "collection");
        expect(spec, `${field.name} produces a column`).not.toBeNull();
        const canonical = getColumnDescriptor(field, dialect, "collection");
        // Compared case-insensitively: this module emits DDL keywords, the descriptor emits the
        // tokens introspection returns.
        expect(
          ddlType(spec as LocalizedColumnSpec, dialect).toLowerCase()
        ).toBe(canonical?.dialectType.toLowerCase());
      }
    }
  );
});
