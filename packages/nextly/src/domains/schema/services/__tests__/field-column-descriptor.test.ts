import { afterEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { PluginFieldType } from "../../../../plugins/contributions";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../field-types/field-type-registry";
import {
  getColumnDescriptor,
  isTextStorageKind,
  type ColumnKind,
} from "../field-column-descriptor";

const field = (overrides: Partial<FieldDefinition>): FieldDefinition =>
  ({ name: "value", type: "text", ...overrides }) as FieldDefinition;

/**
 * A field whose type a plugin contributed, which is by definition not a member of the built-in
 * union — so it is stated structurally rather than through the built-in field type.
 */
const contributedField = (
  overrides: Record<string, unknown>
): FieldDefinition =>
  ({ name: "value", ...overrides }) as unknown as FieldDefinition;

describe("getColumnDescriptor — toggle", () => {
  it("maps a toggle field to a boolean column (Postgres)", () => {
    const desc = getColumnDescriptor(
      { name: "is_active", type: "toggle" } as never,
      "postgresql"
    );
    expect(desc?.dialectType).toBe("bool");
  });
});

/**
 * A field that declares itself short gets a column at the width it declared.
 *
 * The Builder's own creators emit `varchar(120)` for such a field on both dialects that bound a
 * string. A fixed 255 here would size the same field differently depending on which path created
 * the table, and a field declaring more than 255 characters would sit in a column that rejects
 * what its own stored validation accepts.
 */
describe("getColumnDescriptor — a declared text width", () => {
  it.each([
    ["postgresql", "varchar(120)"],
    ["mysql", "varchar(120)"],
  ] as const)("renders the declared width on %s", (dialect, expected) => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, validation: { maxLength: 120 } }),
      dialect
    );

    expect(desc?.dialectType).toBe(expected);
    expect(desc?.length).toBe(120);
  });

  // Above the fixed default too, which is the case that loses data rather than merely differing:
  // a value of 400 characters is accepted by validation and refused by a varchar(255).
  it("renders a width wider than the default", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, validation: { maxLength: 400 } }),
      "mysql"
    );

    expect(desc?.dialectType).toBe("varchar(400)");
  });

  // SQLite has one string type, so the bound lives in validation there. Rendering a width would
  // describe a column the dialect cannot declare.
  it("stays text on sqlite", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, validation: { maxLength: 120 } }),
      "sqlite"
    );

    expect(desc?.dialectType).toBe("text");
  });

  // The creators size a bounded string from validation.maxLength and read no other key, so a
  // top-level `length` must not become the physical width: honouring it gave the same declaration
  // one capacity when created directly and another through the pipeline.
  it("ignores a top-level length the creators do not read", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, length: 500 }),
      "mysql"
    );

    expect(desc?.dialectType).toBe("varchar(255)");
  });

  it("falls back to the default width when none is declared", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" } }),
      "postgresql"
    );

    expect(desc?.dialectType).toBe("varchar(255)");
  });

  // These reach DDL as `VARCHAR(n)`, so a value that is not a whole positive count would be
  // rendered into the statement as written and fail the create.
  it.each([[0], [-5], [12.5]])(
    "ignores a width of %s and uses the default",
    maxLength => {
      const desc = getColumnDescriptor(
        field({ options: { variant: "short" }, validation: { maxLength } }),
        "postgresql"
      );

      expect(desc?.dialectType).toBe("varchar(255)");
    }
  );
});

/**
 * A plugin type that stores text answers the width question exactly as a built-in text field does.
 *
 * Its column is rendered by the same branch, so a narrower rule here bounded a field the Builder's
 * creators left unbounded, and an untouched column then read as a narrowing on every diff.
 */
describe("getColumnDescriptor — a contributed text type", () => {
  const SLUG_TYPE: PluginFieldType = {
    type: "acme-slug",
    storage: "text",
    component: "@acme/slug/admin#SlugField",
  };

  afterEach(() => {
    clearFieldTypes();
  });

  // `options` is the choice list on a select and the payload schema permits that shape on any
  // field, so a field carrying one states no width at all.
  it("reads an array options list as unbounded", () => {
    registerFieldType(SLUG_TYPE);

    const desc = getColumnDescriptor(
      contributedField({
        type: "acme-slug",
        options: [{ label: "A", value: "a" }],
      }),
      "mysql"
    );

    expect(desc?.dialectType).toBe("text");
  });

  it("reads a declared short variant as bounded", () => {
    registerFieldType(SLUG_TYPE);

    const desc = getColumnDescriptor(
      contributedField({
        type: "acme-slug",
        options: { variant: "short" },
        validation: { maxLength: 64 },
      }),
      "postgresql"
    );

    expect(desc?.dialectType).toBe("varchar(64)");
  });

  it("reads a declared long variant as unbounded", () => {
    registerFieldType(SLUG_TYPE);

    const desc = getColumnDescriptor(
      contributedField({ type: "acme-slug", options: { variant: "long" } }),
      "mysql"
    );

    expect(desc?.dialectType).toBe("text");
  });
});

/**
 * Every kind that reaches a string column, enumerated here rather than restated by each caller.
 *
 * A caller holding a string asks this before seeding it. Answered from a local list instead, a
 * caller silently said "not text" for a kind added after it was written.
 */
describe("isTextStorageKind", () => {
  it.each<ColumnKind>(["text", "longText", "shortText", "varchar"])(
    "accepts %s",
    kind => {
      expect(isTextStorageKind(kind)).toBe(true);
    }
  );

  it.each<ColumnKind>([
    "boolean",
    "integer",
    "double",
    "decimal",
    "timestamp",
    "json",
    "fkSingle",
    "skip",
  ])("rejects %s", kind => {
    expect(isTextStorageKind(kind)).toBe(false);
  });
});
