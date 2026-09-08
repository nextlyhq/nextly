import { afterEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { PluginFieldType } from "../../../../plugins/contributions";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../field-types/field-type-registry";
import {
  fieldProducesColumn,
  getColumnDescriptor,
  isTextStorageKind,
  type ColumnKind,
  type ColumnOrigin,
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

describe("getColumnDescriptor — checkbox", () => {
  it("maps a checkbox field to a boolean column (Postgres)", () => {
    // The type is `checkbox`, not `toggle`. `toggle` appears nowhere in the
    // FieldType union or in the descriptor's switch, so it was reaching the
    // unrecognised-type fallback and coming back as `text` -- and the test
    // read that as the boolean mapping being broken. The mapping is fine; the
    // name was wrong.
    const desc = getColumnDescriptor(
      { name: "is_active", type: "checkbox" } as never,
      "postgresql",
      "collection"
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
      dialect,
      "collection"
    );

    expect(desc?.dialectType).toBe(expected);
    expect(desc?.length).toBe(120);
  });

  // Above the fixed default too, which is the case that loses data rather than merely differing:
  // a value of 400 characters is accepted by validation and refused by a varchar(255).
  it("renders a width wider than the default", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, validation: { maxLength: 400 } }),
      "mysql",
      "collection"
    );

    expect(desc?.dialectType).toBe("varchar(400)");
  });

  // SQLite has one string type, so the bound lives in validation there. Rendering a width would
  // describe a column the dialect cannot declare.
  it("stays text on sqlite", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, validation: { maxLength: 120 } }),
      "sqlite",
      "collection"
    );

    expect(desc?.dialectType).toBe("text");
  });

  // The creators size a bounded string from validation.maxLength and read no other key, so a
  // top-level `length` must not become the physical width: honouring it gave the same declaration
  // one capacity when created directly and another through the pipeline.
  it("ignores a top-level length the creators do not read", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" }, length: 500 }),
      "mysql",
      "collection"
    );

    expect(desc?.dialectType).toBe("varchar(255)");
  });

  it("falls back to the default width when none is declared", () => {
    const desc = getColumnDescriptor(
      field({ options: { variant: "short" } }),
      "postgresql",
      "collection"
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
        "postgresql",
        "collection"
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
      "mysql",
      "collection"
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
      "postgresql",
      "collection"
    );

    expect(desc?.dialectType).toBe("varchar(64)");
  });

  it("reads a declared long variant as unbounded", () => {
    registerFieldType(SLUG_TYPE);

    const desc = getColumnDescriptor(
      contributedField({ type: "acme-slug", options: { variant: "long" } }),
      "mysql",
      "collection"
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

/**
 * The same field, read as each builder would have built it.
 *
 * This is the property the origin argument exists for: a text field that states no width has three
 * correct answers, and which one applies is a fact about the entity rather than the field. Asserted
 * together so a change that collapses two of them cannot pass.
 */
describe("getColumnDescriptor — the same field, per builder", () => {
  const unstated = field({ name: "body" });

  it.each([
    // The Schema Builder's collection creator reads silence as unbounded.
    ["collection", "text"],
    // So does its field-group creator, which bounds only on a top-level maxLength.
    ["fieldGroup", "text"],
    // The pipeline built every code-first table with the bounded default.
    ["codeFirst", "varchar(255)"],
  ] as [ColumnOrigin, string][])(
    "an unstated text field is %s -> %s on MySQL",
    (builtBy, expected) => {
      expect(getColumnDescriptor(unstated, "mysql", builtBy)?.dialectType).toBe(
        expected
      );
    }
  );

  // A field group states its width at the top level and its creator never reads a variant, so the
  // two Builder creators disagree about this same field.
  it("reads a field group's top-level maxLength, and only for that builder", () => {
    const declared = contributedField({
      name: "body",
      type: "text",
      maxLength: 120,
    });

    expect(
      getColumnDescriptor(declared, "mysql", "fieldGroup")?.dialectType
    ).toBe("varchar(120)");
    // The collection creator bounds on `options.variant` alone, so the same field is unbounded.
    expect(
      getColumnDescriptor(declared, "mysql", "collection")?.dialectType
    ).toBe("text");
  });

  // The mirror of the case above. A collection field states its width through the variant plus its
  // stored validation, and the field-group creator reads neither, so the disagreement runs both
  // ways rather than one creator simply bounding more often than the other.
  it("reads a collection field's variant, and only for that builder", () => {
    const declared = field({
      options: { variant: "short" },
      validation: { maxLength: 120 },
    });

    expect(
      getColumnDescriptor(declared, "mysql", "collection")?.dialectType
    ).toBe("varchar(120)");
    expect(
      getColumnDescriptor(declared, "mysql", "fieldGroup")?.dialectType
    ).toBe("text");
  });

  // SQLite stores every string in one type, so the builders that disagree on a bounded dialect
  // agree here. Pinned so a width rule cannot leak into a dialect that has no widths to express.
  it("gives every builder the same column on SQLite", () => {
    const variantWidth = field({
      options: { variant: "short" },
      validation: { maxLength: 120 },
    });
    const topLevelWidth = contributedField({
      name: "value",
      type: "text",
      maxLength: 120,
    });

    for (const declared of [variantWidth, topLevelWidth]) {
      for (const builtBy of [
        "collection",
        "fieldGroup",
        "codeFirst",
      ] as ColumnOrigin[]) {
        expect(
          getColumnDescriptor(declared, "sqlite", builtBy)?.dialectType
        ).toBe("text");
      }
    }
  });
});

/**
 * A contributed type's own keys do not reshape its column.
 *
 * The field-group creator strips `maxLength`, `dbType`, `precision`, `scale` and `options` from a
 * contributed type before mapping it: a plugin's keys are its own, and one that happens to be
 * spelled like a core key must not decide the physical column. Reading `maxLength` here bounded a
 * column that creator had just made unbounded, so every later diff reported a type change on it.
 */
describe("getColumnDescriptor — a contributed type inside a field group", () => {
  afterEach(() => {
    clearFieldTypes();
  });

  it("ignores a plugin-owned maxLength", () => {
    registerFieldType({
      type: "acme-note",
      storage: "text",
      component: "@acme/note/admin#Note",
    });

    const field = contributedField({
      name: "note",
      type: "acme-note",
      maxLength: 64,
    });

    expect(getColumnDescriptor(field, "mysql", "fieldGroup")?.dialectType).toBe(
      "text"
    );
  });

  // The mirror: a BUILT-IN field's `maxLength` is core's own key, and this creator does read it.
  it("still reads a built-in field's own maxLength", () => {
    const field = contributedField({
      name: "note",
      type: "text",
      maxLength: 64,
    });

    expect(getColumnDescriptor(field, "mysql", "fieldGroup")?.dialectType).toBe(
      "varchar(64)"
    );
  });
});

/**
 * A field group's `slug` field is not the identity column, and is not treated as one.
 *
 * Collections and singles carry a slug identity column with a unique index, and MySQL cannot index
 * an unbounded string — which is why that column is bounded for those builders whatever the field
 * says. A field group indexes its parent pointer and its own unique fields instead, so the same
 * rule there would bound a column for a constraint the table does not have. Its creator also
 * strips a contributed type's `maxLength` before mapping, so a plugin field that happens to be
 * named `slug` is created as TEXT.
 */
describe("getColumnDescriptor — a field named slug", () => {
  afterEach(() => {
    clearFieldTypes();
  });

  it.each(["collection", "codeFirst"] as ColumnOrigin[])(
    "bounds the identity column on MySQL for %s",
    builtBy => {
      expect(
        getColumnDescriptor(field({ name: "slug" }), "mysql", builtBy)
          ?.dialectType
      ).toMatch(/varchar\(\d+\)/i);
    }
  );

  it("leaves a field group's own slug field unbounded", () => {
    expect(
      getColumnDescriptor(field({ name: "slug" }), "mysql", "fieldGroup")
        ?.dialectType
    ).toBe("text");
  });

  it("does not read a plugin's own maxLength off a field named slug", () => {
    registerFieldType({
      type: "acme-key",
      storage: "text",
      component: "@acme/key/admin#Key",
    });

    const pluginSlug = contributedField({
      name: "slug",
      type: "acme-key",
      maxLength: 32,
    });

    expect(
      getColumnDescriptor(pluginSlug, "mysql", "fieldGroup")?.dialectType
    ).toBe("text");
  });
});

/**
 * A code-first column keeps the shape the pipeline gave it.
 *
 * These readings are the rule this module applied before any builder was named, and that rule is
 * what created every code-first column in every existing database. Describing one any other way
 * proposes a change to a column nobody touched — and for the two unbounded readings on MySQL, the
 * proposal is a narrowing that refuses or truncates whatever is already past 255 characters.
 *
 * Pinned on MySQL because it is the only dialect where the four readings render differently.
 */
describe("getColumnDescriptor — the code-first readings are preserved", () => {
  // Each case builds its own field, because one of them is a shape the TYPED surface does not
  // permit and the payload schema does: `options` is the choice list on a select, and the schema
  // allows that on any field. That mismatch is precisely why the runtime guards it, so the case
  // is stated structurally rather than dropped for not type-checking.
  const cases: Array<[string, FieldDefinition, string]> = [
    // Declared long: unbounded, and the case that loses data if narrowed.
    [
      "a long variant",
      field({ name: "body", options: { variant: "long" } }),
      "text",
    ],
    // A choice list states no width, so it is left unbounded too.
    [
      "a choice list",
      contributedField({
        name: "body",
        type: "text",
        options: [{ label: "A", value: "a" }],
      }),
      "text",
    ],
    // Declared short: bounded at the declared width.
    [
      "a short variant",
      field({
        name: "body",
        options: { variant: "short" },
        validation: { maxLength: 120 },
      }),
      "varchar(120)",
    ],
    // Nothing stated: the bounded default.
    ["no width at all", field({ name: "body" }), "varchar(255)"],
  ];

  it.each(cases)(
    "renders %s the way the pipeline built it",
    (_label, declared, expected) => {
      expect(
        getColumnDescriptor(declared, "mysql", "codeFirst")?.dialectType
      ).toBe(expected);
    }
  );
});

describe("getColumnDescriptor & fieldProducesColumn — field groups and components", () => {
  it.each(["component", "fieldGroup"] as const)(
    "fieldProducesColumn returns false for type %s",
    fieldType => {
      expect(fieldProducesColumn({ type: fieldType })).toBe(false);
    }
  );

  it.each(["component", "fieldGroup"] as const)(
    "getColumnDescriptor returns null for type %s across dialects",
    fieldType => {
      const f = { name: "seo", type: fieldType } as unknown as FieldDefinition;
      expect(getColumnDescriptor(f, "postgresql", "collection")).toBeNull();
      expect(getColumnDescriptor(f, "mysql", "collection")).toBeNull();
      expect(getColumnDescriptor(f, "sqlite", "collection")).toBeNull();
    }
  );
});
