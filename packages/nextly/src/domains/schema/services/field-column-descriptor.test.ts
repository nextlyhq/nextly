/**
 * Plugin field types resolve to their declared storage column via the field-type
 * registry; an unregistered type falls back to a text column.
 *
 * @module domains/schema/services/field-column-descriptor.test
 */
import { afterEach, describe, expect, it } from "vitest";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const numberField = (extra: Record<string, unknown>) =>
  ({ name: "price", type: "number", ...extra }) as any;

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
});
