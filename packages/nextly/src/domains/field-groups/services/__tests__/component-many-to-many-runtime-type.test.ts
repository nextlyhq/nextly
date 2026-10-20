/**
 * A component relation that holds a list gets the JSON column on every route that creates the table.
 *
 * A component has no junction table, so a many-to-many keeps its ids on the component's row, as a
 * `hasMany` or polymorphic relation does. The creating SQL, the drizzle-kit runtime table, the
 * desired schema and the row serializer must all treat that column as a JSON list: a route that
 * creates a scalar column for it either refuses a multi-value save or hands the list back as a
 * string.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { getComponentRowColumnDescriptor } from "../../../schema/services/field-column-descriptor";
import { FieldGroupSchemaService } from "../field-group-schema-service";
import {
  asComponentReferenceList,
  asRowBackedRelationFields,
  shouldTreatAsJson,
} from "../field-group-utils";

const LIST_RELATIONS = {
  "a many-to-many": {
    name: "tags",
    type: "relationship",
    options: { target: "tags", relationType: "manyToMany" },
  },
  "a hasMany relationship": {
    name: "tags",
    type: "relationship",
    relationTo: "tags",
    hasMany: true,
  },
  "a polymorphic relationship": {
    name: "tags",
    type: "relationship",
    relationTo: ["tags", "posts"],
  },
} as const;

const EXPECTED = {
  postgresql: { sql: "JSONB", runtime: "PgJsonb", desired: "jsonb" },
  mysql: { sql: "JSON", runtime: "MySqlJson", desired: "json" },
  sqlite: { sql: "TEXT", runtime: "SQLiteText", desired: "text" },
} as const;

function runtimeColumn(
  dialect: keyof typeof EXPECTED,
  field: unknown
): { columnType: string; notNull: boolean } | undefined {
  const table = new FieldGroupSchemaService(dialect).generateRuntimeSchema(
    "comp_hero",
    [field] as unknown as FieldConfig[],
    { typeColumn: STORAGE_FORMAT.columns.type }
  ) as Table;
  return Object.values(getColumns(table)).find(c => c.name === "tags");
}

function creatingSqlLine(
  dialect: keyof typeof EXPECTED,
  field: unknown
): string {
  const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
    "comp_hero",
    [field] as unknown as FieldConfig[]
  );
  return sql.split("\n").find(line => /["`]tags["`]\s/.test(line)) ?? "";
}

describe.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
  "a component relation holding a list on %s",
  dialect => {
    const expected = EXPECTED[dialect];

    describe.each(Object.entries(LIST_RELATIONS))("%s", (_label, field) => {
      it(`is ${expected.sql} in the creating SQL`, () => {
        const type = /["`]tags["`]\s+(\S+?),?$/.exec(
          creatingSqlLine(dialect, field)
            .trim()
            .replace(/ NOT NULL/, "")
        )?.[1];
        expect(type).toBe(expected.sql);
      });

      it(`is ${expected.runtime} in the runtime table drizzle-kit creates`, () => {
        expect(runtimeColumn(dialect, field)?.columnType).toBe(
          expected.runtime
        );
      });

      it(`is ${expected.desired} in the desired schema`, () => {
        expect(
          getComponentRowColumnDescriptor(
            field as unknown as FieldDefinition,
            dialect,
            "fieldGroup"
          )?.dialectType
        ).toBe(expected.desired);
      });

      it("is written and read as JSON by the row serializer", () => {
        expect(shouldTreatAsJson(field as unknown as FieldConfig)).toBe(true);
      });
    });

    // A relationship column is never NOT NULL: `required` is enforced when the entry is saved, and
    // the desired schema records every relationship column as nullable.
    it("leaves a required many-to-many nullable on both creating routes", () => {
      const required = {
        ...LIST_RELATIONS["a many-to-many"],
        required: true,
      };
      expect(creatingSqlLine(dialect, required)).not.toMatch(/NOT NULL/);
      expect(runtimeColumn(dialect, required)?.notNull).toBe(false);
    });
  }
);

describe("a component's single relationship", () => {
  it("is not a JSON list for the row serializer", () => {
    expect(
      shouldTreatAsJson({
        name: "author",
        type: "relationship",
        options: { target: "users", relationType: "manyToOne" },
      } as unknown as FieldConfig)
    ).toBe(false);
  });
});

describe("reading a component many-to-many's stored value", () => {
  const manyToMany = LIST_RELATIONS["a many-to-many"] as unknown as FieldConfig;

  it("reads a single id as a one-item list", () => {
    expect(asComponentReferenceList(manyToMany, "a")).toEqual(["a"]);
  });

  it("leaves a list and an empty value as they are", () => {
    expect(asComponentReferenceList(manyToMany, ["a", "b"])).toEqual([
      "a",
      "b",
    ]);
    expect(asComponentReferenceList(manyToMany, null)).toBeNull();
  });

  it("leaves an unconverted PostgreSQL array literal as stored, rather than misread it as one id", () => {
    expect(asComponentReferenceList(manyToMany, '{"a","b"}')).toBe('{"a","b"}');
  });

  it("leaves any other field's value alone", () => {
    const single = {
      name: "author",
      type: "relationship",
      options: { target: "users" },
    } as unknown as FieldConfig;
    expect(asComponentReferenceList(single, "a")).toBe("a");
  });
});

describe("a component many-to-many handed to relationship expansion", () => {
  it("is a row-backed hasMany list that keeps the target it names in options.target", () => {
    // A stale `relationTo` beside it must not win: a many-to-many's target is `options.target`.
    const [field] = asRowBackedRelationFields([
      {
        name: "tags",
        type: "relationship",
        relationTo: "stale",
        options: { target: "tags", relationType: "manyToMany" },
      } as unknown as FieldConfig,
    ]) as unknown as {
      hasMany?: boolean;
      relationTo?: unknown;
      options?: { relationType?: unknown };
    }[];
    expect(field).toMatchObject({ hasMany: true, relationTo: "tags" });
    expect(field.options?.relationType).toBeUndefined();
  });
});

describe("an indexed component many-to-many in the creating SQL", () => {
  const indexed = [
    {
      ...LIST_RELATIONS["a many-to-many"],
      index: true,
    },
  ] as unknown as FieldConfig[];
  const indexLine = (dialect: keyof typeof EXPECTED): string | undefined =>
    new FieldGroupSchemaService(dialect)
      .generateMigrationSQL("comp_hero", indexed)
      .split("\n")
      .find(line => line.includes("idx_comp_hero_tags"));

  it("gets no index on MySQL, which cannot index a JSON column", () => {
    expect(indexLine("mysql")).toBeUndefined();
  });

  it("keeps its index where the dialect can index the column", () => {
    expect(indexLine("postgresql")).toBeDefined();
    expect(indexLine("sqlite")).toBeDefined();
  });
});
