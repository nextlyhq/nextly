import { describe, expect, it } from "vitest";

import { CANONICAL_TYPE_TOKENS } from "../diff/normalize-type";
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

// Two implementations answer "which spellings mean one type", and only one is consulted when a
// rename decides whether to move the data.
//
//   normalizeType   collapses aliases to a canonical token — the string PostgreSQL introspection
//                   actually reports, because `udt_name` names the underlying type
//   PG_FAMILIES     is keyed by SPELLING, so it recognises only what it happens to list
//
// A spelling the family table lists but introspection never returns is dead weight; a canonical
// token it omits is worse — that column is incompatible with ITSELF, because `typeFamilyOf` answers
// null for both sides of the pair and the detector falls to drop_and_add. It recreates the column
// empty for a change the diff says is not a change.
//
// Asserted over the alias TARGETS rather than a hand-written list of types. That covers the
// SCALAR spellings, which is where the divergence this repairs lived, and it is narrower than the
// set of strings the detector can receive — `normalizeType` also produces array tokens (`_int4`
// and `integer[]` both canonicalise to `int4[]`), and `Object.values(TYPE_ALIASES)` contains none
// of them. An array column is incompatible with itself here exactly as `float8` was; no field type
// renders one today, because `hasMany` reaches `jsonb`, so the pair is unreachable from this
// product rather than handled.
describe("every canonical type token PostgreSQL introspection can report has a family", () => {
  it("puts each canonical token in the family that type belongs to", () => {
    // 🔴 The population is asserted by MEMBERSHIP, not by size. The filter below passes on an empty
    // result, which a float-less token set satisfies perfectly — so a later edit to `TYPE_ALIASES`
    // dropping the float entries would leave this green while removing the very pair it exists to
    // watch. Naming them is what makes that edit fail here.
    expect(
      CANONICAL_TYPE_TOKENS,
      "the floating-point canonical tokens this check exists to cover"
    ).toEqual(expect.arrayContaining(["float8", "float4"]));

    // 🔴 Null-reachability — that `typeFamilyOf` can still answer null at all — is what stops the
    // filter below being vacuous, and it is asserted by "returns null for unknown types" above
    // rather than here. Declared rather than left to be inferred: a neighbouring control is a real
    // control and a fragile one, and rewriting that test silently empties this one.
    expect(
      CANONICAL_TYPE_TOKENS.filter(
        token => typeFamilyOf(token, "postgresql") === null
      ),
      "introspection reports these spellings and the rename detector does not recognise them — a rename between two columns of such a type drops the data"
    ).toEqual([]);

    // Non-null is the weaker property, and for the self-pair it is enough: one spelling cannot
    // disagree with itself about which family it is in. It says nothing about whether the table is
    // RIGHT, and the separating property is that spellings meaning one storage type share a family.
    // Measured: moving `float8` into `binary` leaves every assertion above green while
    // `numeric -> float8` — a number field whose format changes from decimal to float — silently
    // becomes drop_and_add, which is the same data loss one type along.
    expect(typeFamilyOf("float8", "postgresql")).toBe("decimal");
    expect(typeFamilyOf("float4", "postgresql")).toBe("decimal");
  });
});
