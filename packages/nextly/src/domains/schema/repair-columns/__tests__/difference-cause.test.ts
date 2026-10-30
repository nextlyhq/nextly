import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
  type SupportedDialect,
} from "../../services/field-column-descriptor";
import { differenceCause } from "../difference-cause";
import type {
  ColumnState,
  RepairColumnOrigin,
  RepairEntityKind,
} from "../types";
import { userFieldColumn } from "../user-field-columns";

const field = (over: Record<string, unknown>): FieldDefinition =>
  ({ name: "value", ...over }) as unknown as FieldDefinition;

/** The column the builder `origin` names makes for `f`, as the finder asks it. */
function expectedColumn(args: {
  f: FieldDefinition;
  kind: RepairEntityKind;
  origin: RepairColumnOrigin;
  dialect: SupportedDialect;
}): ColumnState | null {
  const { origin } = args;
  if (origin === "userFields") return userFieldColumn(args.f, args.dialect);
  const describe =
    args.kind === "fieldGroup"
      ? getComponentRowColumnDescriptor
      : getColumnDescriptor;
  const descriptor = describe(args.f, args.dialect, origin);
  return descriptor === null
    ? null
    : { type: descriptor.dialectType, nullable: descriptor.nullable };
}

/** The cause for a live column against the column `f` is expected in, as the finder asks it. */
function causeFor(args: {
  f: FieldDefinition;
  kind: RepairEntityKind;
  origin: RepairColumnOrigin;
  dialect: SupportedDialect;
  live: ColumnState;
}) {
  const expected = expectedColumn(args);
  if (expected === null) throw new Error("the fixture names no column");
  return differenceCause({
    field: args.f,
    kind: args.kind,
    origin: args.origin,
    dialect: args.dialect,
    translation: false,
    live: args.live,
    expected: { type: expected.type, nullable: expected.nullable },
  });
}

describe("differenceCause: legacy shapes", () => {
  it.each<SupportedDialect>(["postgresql", "mysql"])(
    "a Builder repeater held as text on %s was created before 0.0.2-alpha.67",
    dialect => {
      expect(
        causeFor({
          f: field({ type: "repeater", fields: [] }),
          kind: "collection",
          origin: "collection",
          dialect,
          live: { type: "text", nullable: true },
        })
      ).toEqual({
        kind: "legacy",
        shape: "structured-as-text",
        before: "0.0.2-alpha.67",
      });
    }
  );

  it("a Builder group held as text on a Single is the same shape", () => {
    expect(
      causeFor({
        f: field({ type: "group", fields: [] }),
        kind: "single",
        origin: "collection",
        dialect: "postgresql",
        live: { type: "text", nullable: true },
      })
    ).toMatchObject({ kind: "legacy", shape: "structured-as-text" });
  });

  it("a float number held as decimal(10,2) on MySQL", () => {
    expect(
      causeFor({
        f: field({ type: "number", options: { format: "float" } }),
        kind: "collection",
        origin: "collection",
        dialect: "mysql",
        live: { type: "decimal(10,2)", nullable: true },
      })
    ).toEqual({
      kind: "legacy",
      shape: "float-as-decimal",
      before: "0.0.2-alpha.66",
    });
  });

  it("a float number held as numeric(10,2) on PostgreSQL, size reported aside", () => {
    expect(
      causeFor({
        f: field({ type: "number", options: { format: "float" } }),
        kind: "collection",
        origin: "collection",
        dialect: "postgresql",
        live: { type: "numeric", nullable: true, typeModifier: "10,2" },
      })
    ).toMatchObject({ kind: "legacy", shape: "float-as-decimal" });
  });

  it.each(["select", "radio"])(
    "a MySQL %s left as text by the legacy map",
    type => {
      expect(
        causeFor({
          f: field({ type, options: [{ label: "A", value: "a" }] }),
          kind: "collection",
          origin: "collection",
          dialect: "mysql",
          live: { type: "text", nullable: true },
        })
      ).toEqual({
        kind: "legacy",
        shape: "mysql-text-fallback",
        before: "0.0.2-alpha.66",
      });
    }
  );

  it("a MySQL upload left as text by the legacy map", () => {
    expect(
      causeFor({
        f: field({ type: "upload", relationTo: "media" }),
        kind: "collection",
        origin: "collection",
        dialect: "mysql",
        live: { type: "text", nullable: true },
      })
    ).toMatchObject({ kind: "legacy", shape: "mysql-text-fallback" });
  });

  it("a MySQL text field held as text on a field-group table", () => {
    expect(
      causeFor({
        f: field({ type: "text", maxLength: 120 }),
        kind: "fieldGroup",
        origin: "fieldGroup",
        dialect: "mysql",
        live: { type: "text", nullable: true },
      })
    ).toMatchObject({ kind: "legacy", shape: "mysql-text-fallback" });
  });

  it.each<[SupportedDialect, string]>([
    ["postgresql", "uuid"],
    ["postgresql", "text"],
    ["mysql", "varchar(36)"],
  ])(
    "a component many-to-many held in a scalar column on %s (%s)",
    (dialect, type) => {
      expect(
        causeFor({
          f: field({
            type: "relationship",
            relationTo: "posts",
            options: { relationType: "manyToMany" },
          }),
          kind: "fieldGroup",
          origin: "fieldGroup",
          dialect,
          live: { type, nullable: true },
        })
      ).toEqual({
        kind: "legacy",
        shape: "component-list-in-scalar",
        before: "0.0.2-alpha.69",
      });
    }
  );
});

describe("differenceCause: what a current generator still creates", () => {
  // The live type is what each generator writes for the key: the field-group generator types it
  // `uuid` on PostgreSQL, which is itself a difference it still creates.
  it.each<[RepairEntityKind, RepairColumnOrigin, SupportedDialect, string]>([
    ["collection", "collection", "postgresql", "text"],
    ["collection", "collection", "mysql", "varchar(36)"],
    ["single", "collection", "sqlite", "text"],
    ["fieldGroup", "fieldGroup", "postgresql", "uuid"],
  ])(
    "a required relationship in a NOT NULL column (%s, %s, %s)",
    (kind, origin, dialect, type) => {
      expect(
        causeFor({
          f: field({
            type: "relationship",
            relationTo: "posts",
            required: true,
          }),
          kind,
          origin,
          dialect,
          live: { type, nullable: false },
        })
      ).toEqual({ kind: "current-generator" });
    }
  );

  it("a hasMany number the Builder still gives a scalar column", () => {
    expect(
      causeFor({
        f: field({ type: "number", hasMany: true }),
        kind: "collection",
        origin: "collection",
        dialect: "postgresql",
        live: { type: "int4", nullable: true },
      })
    ).toEqual({ kind: "current-generator" });
  });

  it.each<SupportedDialect>(["postgresql", "mysql", "sqlite"])(
    "a required user field the user-extension builder added as a nullable column on %s",
    dialect => {
      // The builder adds a field to an existing `user_ext` without NOT NULL, whatever `required`
      // says, while the descriptor follows its CREATE TABLE and names NOT NULL.
      expect(
        causeFor({
          f: field({ type: "text", required: true }),
          kind: "userFields",
          origin: "userFields",
          dialect,
          live: { type: "text", nullable: true },
        })
      ).toEqual({ kind: "current-generator" });
    }
  );

  it("a field-group date the generator still makes DATETIME on MySQL", () => {
    expect(
      causeFor({
        f: field({ type: "date" }),
        kind: "fieldGroup",
        origin: "fieldGroup",
        dialect: "mysql",
        live: { type: "datetime", nullable: true },
      })
    ).toEqual({ kind: "current-generator" });
  });
});

describe("differenceCause: unknown", () => {
  it("names no cause for a shape no generator is known to create", () => {
    expect(
      causeFor({
        f: field({ type: "text" }),
        kind: "collection",
        origin: "collection",
        dialect: "postgresql",
        live: { type: "int4", nullable: true },
      })
    ).toBeNull();
  });

  it("names no cause for a code-first required relationship held NOT NULL", () => {
    // The code-first builder creates every column from the descriptor, which calls a relationship
    // nullable, so no current generator explains this one.
    expect(
      causeFor({
        f: field({ type: "relationship", relationTo: "posts", required: true }),
        kind: "collection",
        origin: "codeFirst",
        dialect: "postgresql",
        live: { type: "text", nullable: false },
      })
    ).toBeNull();
  });

  it("names no legacy shape for a user field, which no legacy generator built", () => {
    // The same column on a collection is the MySQL legacy map's text fallback; `user_ext` was
    // only ever built by the user-extension builder, so the shape says nothing about it.
    expect(
      causeFor({
        f: field({ type: "text", maxLength: 120 }),
        kind: "userFields",
        origin: "userFields",
        dialect: "mysql",
        live: { type: "text", nullable: true },
      })
    ).toBeNull();
  });

  it.each<[string, Record<string, unknown>, SupportedDialect, ColumnState]>([
    [
      "a repeater held as text",
      { type: "repeater", fields: [] },
      "postgresql",
      { type: "text", nullable: true },
    ],
    [
      "a MySQL select held as text",
      { type: "select", options: [{ label: "A", value: "a" }] },
      "mysql",
      { type: "text", nullable: true },
    ],
  ])(
    "names no legacy shape for %s in a translation table, which no legacy generator built",
    (_, shape, dialect, live) => {
      // The same column on the Builder's own table is legacy; the translation table has only ever
      // been built from the descriptor, so the shape says nothing about how it came to differ.
      const f = field(shape);
      const descriptor = getColumnDescriptor(f, dialect, "collection");
      if (descriptor === null) throw new Error("the fixture names no column");
      expect(
        differenceCause({
          field: f,
          kind: "collection",
          origin: "collection",
          dialect,
          translation: true,
          live,
          expected: { type: descriptor.dialectType, nullable: true },
        })
      ).toBeNull();
    }
  );
});
