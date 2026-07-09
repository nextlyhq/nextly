import { describe, it, expect } from "vitest";

import { ddlType, q, castText } from "./ddl-types";

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
