/**
 * The app's override of a column an entity's own fields generate.
 *
 * What it may change is the column's storage, within its value family, and
 * nothing else; who may make it is the app. Each refusal is asked here
 * through the draft the app's schema hook writes into, so what is pinned is
 * the declaration as an app makes it, not a helper beside it. What the
 * override does to the tables is pinned in
 * `column-override.integration.test.ts`, on every dialect.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { SupportedDialect } from "../../../../database/schema-registry";
import { getColumnDescriptor } from "../../services/field-column-descriptor";
import { withColumnOverride } from "../../services/runtime-schema-generator";
import {
  buildExtensionSchema,
  type ExtensionSchemaInput,
} from "../build-extension-schema";
import type { SchemaHook, SeedEntityTable } from "../draft";
import { col, defineTable, type ColumnBuilder } from "../dsl";
import { withEntityContributions } from "../entity-contributions";
import { entitySeedColumns } from "../entity-seed";

const TABLE = "dc_posts";

/** A collection as the config seeds it: its fields' columns and its own. */
function posts(dialect: SupportedDialect = "postgresql"): SeedEntityTable {
  return {
    name: TABLE,
    slug: "posts",
    entityKind: "collection",
    columns: entitySeedColumns(
      {
        entityKind: "collection",
        tableName: TABLE,
        fields: [
          { name: "city", type: "text" },
          { name: "body", type: "textarea" },
          { name: "code", type: "text", unique: true },
          { name: "views", type: "number" },
          {
            name: "price",
            type: "number",
            dbType: "decimal",
            precision: 10,
            scale: 2,
          },
          { name: "ratio", type: "number", options: { format: "float" } },
          { name: "live", type: "checkbox" },
          { name: "author", type: "relationship", relationTo: "users" },
        ] as unknown as { name: string; type: string }[],
      },
      dialect
    ),
  };
}

function input(
  app: SchemaHook,
  extra: Partial<ExtensionSchemaInput> = {}
): ExtensionSchemaInput {
  return {
    dialect: "postgresql",
    coreTableNames: ["users"],
    entities: [posts()],
    pluginPrefixes: new Map([["fx", "fx"]]),
    plugins: [],
    app: { owner: { kind: "app" }, extend: [app] },
    ...extra,
  };
}

/** The override `column` → `storage` compiles to, or the refusal's message. */
async function override(
  column: string,
  storage: ColumnBuilder
): Promise<unknown> {
  const schema = await buildExtensionSchema(
    input(({ schema: draft }) => draft.overrideColumn(TABLE, column, storage))
  );
  return schema.columnOverrides.get(TABLE)?.[0];
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    const errors = (error as NextlyError).publicData as {
      errors: { message: string }[];
    };
    return errors.errors.map(e => e.message).join("\n");
  }
  return expect.unreachable("must be refused");
}

describe("a string field's column", () => {
  it.each<[string, ColumnBuilder, Record<string, unknown>]>([
    // Payload's `varchar('city', { length: 10 })`, bounded on every dialect
    // that enforces a width.
    ["col.varchar(10)", col.varchar(10), { kind: "shortText", length: 10 }],
    ["col.shortText()", col.shortText(), { kind: "shortText", length: 255 }],
    ["col.text()", col.text(), { kind: "text" }],
    ["col.longText()", col.longText(), { kind: "longText" }],
  ])("may become %s", async (_name, storage, expected) => {
    expect(await override("city", storage)).toEqual({
      column: "city",
      owner: { kind: "app" },
      ...expected,
    });
  });

  it.each<[string, ColumnBuilder, RegExp]>([
    ["char", col.char(10), /cannot be overridden to char/],
    ["uuid", col.uuid(), /cannot be overridden to uuid/],
    ["enum", col.enum(["a", "b"]), /enum values/],
    ["integer", col.integer(), /cannot be overridden to integer/],
  ])(
    "may not become %s, which changes what its values are",
    async (_n, s, m) => {
      expect(await refusal(() => override("city", s))).toMatch(m);
    }
  );

  it("names the column by its field's key or its SQL name alike", async () => {
    const schema = await buildExtensionSchema(
      input(({ schema: draft }) => {
        draft.overrideColumn(TABLE, "city", col.varchar(40));
      })
    );
    expect(schema.columnOverrides.get(TABLE)).toHaveLength(1);
  });
});

describe("a number field's column", () => {
  it("may widen a whole number to bigint", async () => {
    expect(await override("views", col.bigint())).toMatchObject({
      kind: "bigint",
    });
  });

  it("may not narrow a whole number to smallint", async () => {
    expect(await refusal(() => override("views", col.smallint()))).toMatch(
      /may only widen a number/
    );
  });

  it("may grow a decimal's digits on either side of the point", async () => {
    expect(await override("price", col.decimal(14, 4))).toMatchObject({
      kind: "decimal",
      precision: 14,
      scale: 4,
    });
  });

  it.each<[string, ColumnBuilder]>([
    ["fewer fractional digits", col.decimal(10, 1)],
    ["fewer whole digits", col.decimal(9, 2)],
  ])("may not keep %s", async (_n, storage) => {
    expect(await refusal(() => override("price", storage))).toMatch(
      /may only widen a number/
    );
  });

  it("may not change a float, whose only other storage loses precision", async () => {
    expect(await refusal(() => override("ratio", col.real()))).toMatch(
      /floating-point/
    );
  });
});

describe("what an override may not say", () => {
  it.each<[string, ColumnBuilder, RegExp]>([
    ["nullable", col.varchar(10, { nullable: true }), /nullable/],
    ["a default", col.varchar(10, { default: "x" }), /a default/],
  ])("refuses %s, which stays the field's", async (_n, storage, message) => {
    expect(await refusal(() => override("city", storage))).toMatch(message);
  });
});

describe("which columns an override reaches", () => {
  it("refuses a plugin, at startup", async () => {
    const message = await refusal(() =>
      buildExtensionSchema(
        input(() => {}, {
          plugins: [
            {
              owner: { kind: "plugin", id: "fx" },
              extend: [
                ({ schema }) =>
                  schema.overrideColumn(TABLE, "city", col.varchar(10)),
              ],
            },
          ],
        })
      )
    );
    expect(message).toMatch(/Only the app may override/);
  });

  it.each<[string, string, RegExp]>([
    ["a system column", "created_at", /keeps for itself/],
    ["a relationship's key", "author", /holds the id/],
    ["a column the table lacks", "missing", /has no column "missing"/],
  ])("refuses %s", async (_n, column, message) => {
    expect(await refusal(() => override(column, col.text()))).toMatch(message);
  });

  it("refuses a boolean, which has one storage", async () => {
    expect(await refusal(() => override("live", col.integer()))).toMatch(
      /a boolean, which has no other storage/
    );
  });

  it("refuses a table that is not an entity's", async () => {
    const message = await refusal(() =>
      buildExtensionSchema(
        input(({ schema }) => {
          schema.addTable(defineTable("app_notes", { id: col.id() }));
          schema.overrideColumn("app_notes", "id", col.text());
        })
      )
    );
    expect(message).toMatch(/not a collection's, a Single's or a component's/);
  });

  it("refuses a hidden column another owner contributed", async () => {
    const message = await refusal(() =>
      buildExtensionSchema(
        input(
          ({ schema }) =>
            schema.overrideColumn(TABLE, "search_key", col.varchar(10)),
          {
            plugins: [
              {
                owner: { kind: "plugin", id: "fx" },
                extend: [
                  ({ schema }) =>
                    schema.extendTable(TABLE, {
                      columns: { searchKey: col.text({ nullable: true }) },
                    }),
                ],
              },
            ],
          }
        )
      )
    );
    expect(message).toMatch(/by plugin "fx", and only its contributor/);
  });

  it("refuses a second override of one column", async () => {
    const message = await refusal(() =>
      buildExtensionSchema(
        input(({ schema }) => {
          schema.overrideColumn(TABLE, "city", col.varchar(10));
          schema.overrideColumn(TABLE, "city", col.varchar(20));
        })
      )
    );
    expect(message).toMatch(/already overridden/);
  });

  it("refuses an unbounded string where the field's own unique index needs a bound", async () => {
    // MySQL cannot key TEXT without a prefix length, so a unique field's
    // column must stay bounded on every dialect.
    expect(await refusal(() => override("code", col.longText()))).toMatch(
      /mysql/i
    );
    expect(await override("code", col.varchar(100))).toMatchObject({
      kind: "shortText",
      length: 100,
    });
  });

  it("leaves the table as it was when refused", async () => {
    const schema = await buildExtensionSchema(
      input(({ schema: draft }) => {
        expect(() =>
          draft.overrideColumn(TABLE, "city", col.integer())
        ).toThrow(NextlyError);
        expect(
          draft.getTable(TABLE)?.columns.find(c => c.name === "city")?.kind
        ).toBe("text");
      })
    );
    expect(schema.columnOverrides.size).toBe(0);
  });
});

describe("one override, in the desired table and the runtime table alike", () => {
  it.each<[SupportedDialect, string]>([
    ["postgresql", "varchar(10)"],
    ["mysql", "varchar(10)"],
    // SQLite keeps no width, so the override changes no storage there.
    ["sqlite", "text"],
  ])("renders col.varchar(10) on %s as %s", async (dialect, type) => {
    const schema = await buildExtensionSchema({
      ...input(({ schema: draft }) =>
        draft.overrideColumn(TABLE, "city", col.varchar(10))
      ),
      dialect,
      entities: [posts(dialect)],
    });
    const spec = withEntityContributions(
      {
        name: TABLE,
        columns: [{ name: "city", type: "text", nullable: true }],
      },
      schema,
      undefined,
      dialect
    );
    expect(spec.columns[0]).toMatchObject({ type, nullable: true });

    const descriptor = getColumnDescriptor(
      { name: "city", type: "text" } as Parameters<
        typeof getColumnDescriptor
      >[0],
      dialect,
      "codeFirst"
    )!;
    const runtime = withColumnOverride(
      descriptor,
      schema.columnOverrides.get(TABLE) ?? [],
      dialect
    );
    expect(runtime).toMatchObject({
      name: "city",
      dialectType: type,
      nullable: descriptor.nullable,
    });
  });
});
