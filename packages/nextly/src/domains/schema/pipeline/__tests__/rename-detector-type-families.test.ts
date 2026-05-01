import { describe, expect, it } from "vitest";

import {
  isTypesCompatible,
  typeFamilyOf,
} from "../rename-detector-type-families";

describe("typeFamilyOf - leading-token extraction", () => {
  it("strips parenthesized size suffix", () => {
    expect(typeFamilyOf("varchar(255)", "postgresql")).toBe("text");
    expect(typeFamilyOf("char(36)", "postgresql")).toBe("text");
    expect(typeFamilyOf("numeric(10,2)", "postgresql")).toBe("decimal");
  });

  it("strips trailing modifiers", () => {
    expect(typeFamilyOf("text NOT NULL", "postgresql")).toBe("text");
    expect(typeFamilyOf("integer DEFAULT 0", "postgresql")).toBe("integer");
    expect(typeFamilyOf("varchar(50) DEFAULT 'x'", "postgresql")).toBe("text");
  });

  it("normalizes case-insensitive type tokens", () => {
    expect(typeFamilyOf("TEXT", "postgresql")).toBe("text");
    expect(typeFamilyOf("Integer", "postgresql")).toBe("integer");
  });

  it("returns null for unknown types", () => {
    expect(typeFamilyOf("hstore", "postgresql")).toBeNull();
    expect(typeFamilyOf("", "postgresql")).toBeNull();
  });
});

describe("isTypesCompatible - PG", () => {
  it("text family is compatible within itself", () => {
    expect(isTypesCompatible("text", "varchar(255)", "postgresql")).toBe(true);
    expect(isTypesCompatible("varchar(50)", "char(10)", "postgresql")).toBe(
      true
    );
    expect(isTypesCompatible("text", "text", "postgresql")).toBe(true);
  });

  it("PG bpchar (information_schema udt_name for char) joins text family", () => {
    // Live PG introspection returns 'bpchar' for char(N) columns, not 'char'.
    // Without bpchar in the family, a legitimate char(36) -> text rename
    // would default to drop_and_add.
    expect(isTypesCompatible("bpchar", "text", "postgresql")).toBe(true);
    expect(isTypesCompatible("bpchar", "varchar(50)", "postgresql")).toBe(true);
  });

  it("integer family is compatible within itself", () => {
    expect(isTypesCompatible("integer", "bigint", "postgresql")).toBe(true);
    expect(isTypesCompatible("smallint", "int", "postgresql")).toBe(true);
  });

  it("text and integer are incompatible across families", () => {
    expect(isTypesCompatible("text", "integer", "postgresql")).toBe(false);
    expect(isTypesCompatible("varchar(50)", "bigint", "postgresql")).toBe(
      false
    );
  });

  it("date/time families are kept separate", () => {
    expect(isTypesCompatible("date", "timestamp", "postgresql")).toBe(false);
    expect(isTypesCompatible("time", "timestamp", "postgresql")).toBe(false);
    expect(isTypesCompatible("timestamp", "timestamptz", "postgresql")).toBe(
      true
    );
  });

  it("uuid is its own family on PG (not text)", () => {
    expect(isTypesCompatible("uuid", "text", "postgresql")).toBe(false);
    expect(isTypesCompatible("uuid", "uuid", "postgresql")).toBe(true);
  });

  it("json and jsonb are compatible", () => {
    expect(isTypesCompatible("json", "jsonb", "postgresql")).toBe(true);
  });

  it("unknown types are incompatible (defensive)", () => {
    expect(isTypesCompatible("hstore", "text", "postgresql")).toBe(false);
    expect(isTypesCompatible("", "text", "postgresql")).toBe(false);
    expect(isTypesCompatible("text", "", "postgresql")).toBe(false);
  });
});

describe("isTypesCompatible - MySQL", () => {
  it("text family includes tinytext/mediumtext/longtext", () => {
    expect(isTypesCompatible("text", "longtext", "mysql")).toBe(true);
    expect(isTypesCompatible("varchar(255)", "tinytext", "mysql")).toBe(true);
  });

  it("integer family includes tinyint and mediumint", () => {
    expect(isTypesCompatible("tinyint", "bigint", "mysql")).toBe(true);
    expect(isTypesCompatible("mediumint", "int", "mysql")).toBe(true);
  });

  it("datetime is in the timestamp family", () => {
    expect(isTypesCompatible("datetime", "timestamp", "mysql")).toBe(true);
  });

  it("binary family", () => {
    expect(isTypesCompatible("binary(16)", "varbinary(255)", "mysql")).toBe(
      true
    );
    expect(isTypesCompatible("blob", "longblob", "mysql")).toBe(true);
  });
});

describe("isTypesCompatible - SQLite", () => {
  it("text family includes varchar/char (storage class affinity)", () => {
    expect(isTypesCompatible("text", "varchar(50)", "sqlite")).toBe(true);
  });

  it("integer family includes bigint", () => {
    expect(isTypesCompatible("integer", "bigint", "sqlite")).toBe(true);
  });

  it("decimal/real family", () => {
    expect(isTypesCompatible("real", "decimal(10,2)", "sqlite")).toBe(true);
  });

  it("text and integer remain incompatible", () => {
    expect(isTypesCompatible("text", "integer", "sqlite")).toBe(false);
  });
});

describe("isTypesCompatible - symmetry", () => {
  it("compatibility is symmetric on PG", () => {
    expect(isTypesCompatible("text", "varchar(50)", "postgresql")).toBe(
      isTypesCompatible("varchar(50)", "text", "postgresql")
    );
  });

  it("incompatibility is symmetric on PG", () => {
    expect(isTypesCompatible("text", "integer", "postgresql")).toBe(
      isTypesCompatible("integer", "text", "postgresql")
    );
  });
});
