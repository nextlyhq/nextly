/**
 * Plugin field types resolve to their declared storage column via the field-type
 * registry; an unregistered type falls back to a text column.
 *
 * @module domains/schema/services/field-column-descriptor.test
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { normalizeType } from "../pipeline/diff/normalize-type";
import {
  clearFieldTypes,
  registerFieldType,
} from "../field-types/field-type-registry";
import {
  getColumnDescriptor,
  type SupportedDialect,
} from "./field-column-descriptor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const field = (type: string) => ({ name: "content", type }) as any;

const numberField = (extra: Partial<FieldDefinition>): FieldDefinition => ({
  name: "price",
  type: "number",
  ...extra,
});

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe("getColumnDescriptor — plugin field types", () => {
  afterEach(() => clearFieldTypes());

  it("maps a registered plugin field type to its storage column (json)", () => {
    clearFieldTypes();
    registerFieldType({
      type: "page-builder",
      storage: "json",
      component: "@x/y#Z",
    });
    const d = getColumnDescriptor(field("page-builder"), "postgres");
    expect(d?.kind).toBe("json");
  });

  it("falls back to a text column for an unregistered field type", () => {
    clearFieldTypes();
    const d = getColumnDescriptor(field("page-builder"), "postgres");
    expect(d?.kind).toBe("text");
  });
});

describe("getColumnDescriptor: number storage", () => {
  it("defaults a code-first number field to integer (unchanged behavior)", () => {
    for (const dialect of DIALECTS) {
      const d = getColumnDescriptor(numberField({}), dialect);
      expect(d?.kind).toBe("integer");
      expect(d?.precision).toBeUndefined();
    }
  });

  it("keeps the builder's options.format='float' mapping to double", () => {
    const d = getColumnDescriptor(
      numberField({ options: { format: "float" } }),
      "postgresql"
    );
    expect(d?.kind).toBe("double");
  });

  it("maps dbType:'decimal' to an exact decimal column with default 10,2", () => {
    const expected: Record<SupportedDialect, string> = {
      postgresql: "numeric(10, 2)",
      mysql: "decimal(10,2)",
      sqlite: "numeric",
    };
    for (const dialect of DIALECTS) {
      const d = getColumnDescriptor(
        numberField({ dbType: "decimal" }),
        dialect
      );
      expect(d?.kind).toBe("decimal");
      expect(d?.dialectType).toBe(expected[dialect]);
      expect(d?.precision).toBe(10);
      expect(d?.scale).toBe(2);
    }
  });

  it("honors author-set precision and scale", () => {
    const d = getColumnDescriptor(
      numberField({ dbType: "decimal", precision: 12, scale: 4 }),
      "mysql"
    );
    expect(d?.dialectType).toBe("decimal(12,4)");
    expect(d?.precision).toBe(12);
    expect(d?.scale).toBe(4);
  });

  it("emits a decimal dialectType that the diff normalizes to numeric (no phantom type change)", () => {
    // The live side introspects a decimal/numeric column as "numeric" (PG udt),
    // "decimal(10,2)" (MySQL), or "numeric" (SQLite). All must collapse to the
    // same token as the descriptor's dialectType, or the diff churns on apply.
    for (const dialect of DIALECTS) {
      const d = getColumnDescriptor(
        numberField({ dbType: "decimal" }),
        dialect
      );
      expect(normalizeType(d?.dialectType)).toBe("numeric");
    }
    // Introspection-shaped inputs normalize to the same token.
    expect(normalizeType("numeric")).toBe("numeric");
    expect(normalizeType("decimal(10,2)")).toBe("numeric");
  });

  it("stores a hasMany number as JSON, not a scalar numeric column", () => {
    // The write path stringifies a hasMany number to a JSON array, so a scalar
    // integer/decimal column would reject it. hasMany wins over dbType.
    for (const dialect of DIALECTS) {
      expect(
        getColumnDescriptor(numberField({ hasMany: true }), dialect)?.kind
      ).toBe("json");
      expect(
        getColumnDescriptor(
          numberField({ hasMany: true, dbType: "decimal" }),
          dialect
        )?.kind
      ).toBe("json");
    }
  });
});

// Free text is the one field type whose width is not settled by what it holds. On MySQL the two
// renderings are 255 characters apart, so a field that knows it is unbounded has to be able to say
// so rather than discover the ceiling when an editor's paste is rejected by the database.
describe("a text field may state its own width", () => {
  const textField = (variant?: "short" | "long") =>
    ({
      name: "body",
      type: "text",
      ...(variant ? { options: { variant } } : {}),
    }) as never;

  it("renders the wide type on every dialect when the field says it is long", () => {
    expect(getColumnDescriptor(textField("long"), "mysql")?.kind).toBe(
      "longText"
    );
    expect(getColumnDescriptor(textField("long"), "postgresql")?.kind).toBe(
      "longText"
    );
    expect(getColumnDescriptor(textField("long"), "sqlite")?.kind).toBe(
      "longText"
    );
  });

  // 🔴 Absent, the answer must not move. Every table already created through this path has the
  // narrow kind, and changing it would make each of them read as drift on the next diff.
  it("keeps the existing kind when the field says nothing", () => {
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      expect(getColumnDescriptor(textField(), dialect)?.kind).toBe("text");
    }
  });

  it("keeps the existing kind when the field says it is short", () => {
    expect(getColumnDescriptor(textField("short"), "mysql")?.kind).toBe("text");
  });

  // The signal belongs to free text alone. These are bounded by what they store, and widening them
  // would cost MySQL the index it can build on a varchar.
  it("ignores the signal on types whose width their content settles", () => {
    for (const type of ["email", "password", "select", "radio"]) {
      const field = {
        name: "f",
        type,
        options: { variant: "long" },
      } as never;
      expect(getColumnDescriptor(field, "mysql")?.kind).toBe("text");
    }
  });
});
