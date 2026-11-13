/**
 * Foreign keys, checks and relations one owner adds to another's table.
 *
 * The app, and a plugin that depends on a table's owner, may add them to a
 * plugin's table. Each key and check is then the contributor's element: it is
 * recorded per element under the name the table's spec gives it, and kept
 * out of the spec's own fields, so it travels in the contributor's migrations
 * and the owner never reads it as drift. Who may add what, and to which
 * table, is refused at startup otherwise.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { NextlyError } from "../../../../errors/nextly-error";
import { buildExtensionSchema } from "../build-extension-schema";
import type { SchemaHook } from "../draft";
import { col, defineTable } from "../dsl";

beforeAll(async () => {
  await loadDialectTables("postgresql");
});

const HOST = "@acme/host";
const ADDER = "@acme/adder";
const OTHER = "@acme/other";

const items = defineTable("items", {
  id: col.id(),
  label: col.shortText({ nullable: true }),
});
const marks = defineTable("marks", { id: col.id() });
const others = defineTable("others", { id: col.id() });

/** Compile the host, the adder (with `hook`) and a third plugin. */
function compile(
  hook: SchemaHook,
  options: {
    adderDependsOn?: string[];
    as?: "adder" | "app";
    entities?: Parameters<typeof buildExtensionSchema>[0]["entities"];
  } = {}
) {
  const asApp = options.as === "app";
  return buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users"],
    entities: options.entities ?? [],
    pluginPrefixes: new Map([
      [HOST, "hs"],
      [ADDER, "ad"],
      [OTHER, "ot"],
    ]),
    dependencies: new Map([
      [ADDER, new Set(options.adderDependsOn ?? [HOST])],
      [OTHER, new Set([HOST])],
    ]),
    plugins: [
      { owner: { kind: "plugin", id: HOST }, tables: [items] },
      { owner: { kind: "plugin", id: OTHER }, tables: [others] },
      {
        owner: { kind: "plugin", id: ADDER },
        tables: [marks],
        ...(asApp ? {} : { extend: [hook] }),
      },
    ],
    ...(asApp ? { app: { owner: { kind: "app" }, extend: [hook] } } : {}),
  });
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected the compile to be refused, and it was not");
}

/** The adder keys a column of its own on the host's table to its own table. */
const keyAndCheck: SchemaHook = ({ schema }) => {
  schema.extendTable("hs__items", {
    columns: { markId: col.varchar(36, { nullable: true }) },
    foreignKeys: [
      {
        columns: ["markId"],
        references: { table: "ad__marks", columns: ["id"] },
        onDelete: "set null",
      },
    ],
    checks: [{ name: "label_short", sql: "length(label) < 200" }],
    relations: [
      {
        name: "mark",
        kind: "one",
        targetTable: "ad__marks",
        fromColumn: "mark_id",
      },
    ],
  });
};

describe("a plugin adding keys, checks and relations to a dependency's table", () => {
  it("records each key and check as the contributor's element, under the spec's name", async () => {
    const schema = await compile(keyAndCheck);
    const spec = schema.specs.find(one => one.name === "hs__items");
    const fkName = spec?.foreignKeys?.find(
      fk => fk.columns[0] === "mark_id"
    )?.name;
    const checkName = spec?.checks?.find(ck => ck.sql.includes("length"))?.name;
    expect(fkName).toBeDefined();
    expect(checkName).toBeDefined();
    const elements = schema.elementOwners.get("hs__items") ?? [];
    expect(elements).toContainEqual({
      elementKind: "fk",
      elementName: fkName,
      owner: { kind: "plugin", id: ADDER },
    });
    expect(elements).toContainEqual({
      elementKind: "check",
      elementName: checkName,
      owner: { kind: "plugin", id: ADDER },
    });
  });

  it("keeps who added a key out of the compiled spec the diff compares", async () => {
    const schema = await compile(keyAndCheck);
    const spec = schema.specs.find(one => one.name === "hs__items");
    for (const fk of spec?.foreignKeys ?? []) {
      expect(Object.keys(fk)).not.toContain("contributedBy");
    }
    for (const check of spec?.checks ?? []) {
      expect(Object.keys(check)).not.toContain("contributedBy");
    }
  });

  it("gives the host's table the relation edge", async () => {
    const schema = await compile(keyAndCheck);
    expect(
      (schema.relations.get("hs__items") ?? []).map(edge => edge.key)
    ).toContain("mark");
  });

  it("is refused without a dependency on the table's owner", async () => {
    const message = await refusal(() =>
      compile(keyAndCheck, { adderDependsOn: [] })
    );
    expect(message).toMatch(/plugin "@acme\/adder"/);
    expect(message).toMatch(/plugin "@acme\/host"/);
    expect(message).toMatch(/dependsOn/);
  });

  it("refuses a check alone without the dependency, by the constraint rule itself", async () => {
    const message = await refusal(() =>
      compile(
        ({ schema }) =>
          schema.extendTable("hs__items", {
            checks: [{ name: "label_short", sql: "length(label) < 200" }],
          }),
        { adderDependsOn: [] }
      )
    );
    expect(message).toMatch(/may not add foreign keys, checks or relations/);
  });

  it("lets the app add a key and a check, recorded as the app's", async () => {
    const schema = await compile(
      ({ schema: draft }) =>
        draft.extendTable("hs__items", {
          checks: [{ name: "label_nonempty", sql: "length(label) > 0" }],
        }),
      { as: "app" }
    );
    expect(schema.elementOwners.get("hs__items")).toContainEqual(
      expect.objectContaining({ elementKind: "check", owner: { kind: "app" } })
    );
  });

  it("records nothing for an owner adding a key to its own table", async () => {
    const own: SchemaHook = ({ schema }) =>
      schema.extendTable("ad__marks", {
        columns: { itemId: col.text({ nullable: true }) },
        foreignKeys: [
          {
            columns: ["itemId"],
            references: { table: "hs__items", columns: ["id"] },
          },
        ],
      });
    const schema = await compile(own);
    expect(schema.elementOwners.get("ad__marks")).toBeUndefined();
    expect(
      schema.specs.find(one => one.name === "ad__marks")?.foreignKeys
    ).toHaveLength(1);
  });
});

describe("what a contributed key, check or relation is refused for", () => {
  it("an entity's table, which takes only hidden columns and indexes", async () => {
    const message = await refusal(() =>
      compile(
        ({ schema }) =>
          schema.extendTable("dc_posts", {
            checks: [{ name: "x", sql: "1 = 1" }],
          }),
        {
          entities: [
            {
              name: "dc_posts",
              slug: "posts",
              entityKind: "collection",
              columns: [{ name: "id", kind: "varchar", nullable: false }],
            },
          ],
        }
      )
    );
    expect(message).toMatch(/only to a plugin's or the app's own tables/);
  });

  it("a key to another plugin's table the contributor does not depend on", async () => {
    const message = await refusal(() =>
      compile(({ schema }) =>
        schema.extendTable("hs__items", {
          columns: { otherId: col.text({ nullable: true }) },
          foreignKeys: [
            {
              columns: ["otherId"],
              references: { table: "ot__others", columns: ["id"] },
            },
          ],
        })
      )
    );
    expect(message).toMatch(/"ot__others"/);
    expect(message).toMatch(/plugin "@acme\/other"/);
  });

  it("a key on a column a third plugin contributed, without depending on it", async () => {
    const message = await refusal(() =>
      buildExtensionSchema({
        dialect: "postgresql",
        coreTableNames: ["users"],
        entities: [],
        pluginPrefixes: new Map([
          [HOST, "hs"],
          [ADDER, "ad"],
          [OTHER, "ot"],
        ]),
        dependencies: new Map([
          [OTHER, new Set([HOST])],
          [ADDER, new Set([HOST])],
        ]),
        plugins: [
          { owner: { kind: "plugin", id: HOST }, tables: [items] },
          {
            owner: { kind: "plugin", id: OTHER },
            tables: [others],
            extend: [
              ({ schema }) =>
                schema.extendTable("hs__items", {
                  columns: { shared: col.text({ nullable: true }) },
                }),
            ],
          },
          {
            owner: { kind: "plugin", id: ADDER },
            tables: [marks],
            extend: [
              ({ schema }) =>
                schema.extendTable("hs__items", {
                  foreignKeys: [
                    {
                      columns: ["shared"],
                      references: { table: "ad__marks", columns: ["id"] },
                    },
                  ],
                }),
            ],
          },
        ],
      })
    );
    expect(message).toMatch(/foreign key/);
    expect(message).toMatch(/"shared"/);
    expect(message).toMatch(/plugin "@acme\/other"/);
  });

  it("a relation named as one the table already has", async () => {
    const message = await refusal(() =>
      compile(({ schema }) =>
        schema.extendTable("hs__items", {
          relations: [
            {
              name: "label",
              kind: "one",
              targetTable: "ad__marks",
              fromColumn: "label",
            },
          ],
        })
      )
    );
    expect(message).toMatch(/already has a relation or a column named "label"/);
  });

  it("two relations of one name in the same call", async () => {
    const message = await refusal(() =>
      compile(({ schema }) =>
        schema.extendTable("hs__items", {
          relations: [
            {
              name: "owner",
              kind: "one",
              targetTable: "ad__marks",
              fromColumn: "id",
            },
            {
              name: "owner",
              kind: "one",
              targetTable: "ad__marks",
              fromColumn: "id",
            },
          ],
        })
      )
    );
    expect(message).toMatch(/already has a relation or a column named "owner"/);
  });

  it("a key to an app table, which the app declares after every plugin", async () => {
    const notes = defineTable("notes", { id: col.id() });
    const message = await refusal(() =>
      buildExtensionSchema({
        dialect: "postgresql",
        coreTableNames: ["users"],
        entities: [],
        pluginPrefixes: new Map([
          [HOST, "hs"],
          [ADDER, "ad"],
        ]),
        dependencies: new Map([[ADDER, new Set([HOST])]]),
        plugins: [
          { owner: { kind: "plugin", id: HOST }, tables: [items] },
          {
            owner: { kind: "plugin", id: ADDER },
            tables: [marks],
            extend: [
              ({ schema }) =>
                schema.extendTable("hs__items", {
                  columns: { noteId: col.varchar(36, { nullable: true }) },
                  foreignKeys: [
                    {
                      columns: ["noteId"],
                      references: { table: "notes", columns: ["id"] },
                    },
                  ],
                }),
            ],
          },
        ],
        app: { owner: { kind: "app" }, tables: [notes] },
      })
    );
    expect(message).toMatch(/"notes", which the app declares/);
  });

  it("a key to a later plugin's table the contributor does not depend on", async () => {
    const later = "@acme/later";
    const message = await refusal(() =>
      buildExtensionSchema({
        dialect: "postgresql",
        coreTableNames: ["users"],
        entities: [],
        pluginPrefixes: new Map([
          [HOST, "hs"],
          [ADDER, "ad"],
          [later, "lt"],
        ]),
        dependencies: new Map([[ADDER, new Set([HOST])]]),
        plugins: [
          { owner: { kind: "plugin", id: HOST }, tables: [items] },
          {
            owner: { kind: "plugin", id: ADDER },
            tables: [marks],
            extend: [
              ({ schema }) =>
                schema.extendTable("hs__items", {
                  columns: { otherId: col.varchar(36, { nullable: true }) },
                  foreignKeys: [
                    {
                      columns: ["otherId"],
                      references: { table: "lt__others", columns: ["id"] },
                    },
                  ],
                }),
            ],
          },
          { owner: { kind: "plugin", id: later }, tables: [others] },
        ],
      })
    );
    expect(message).toMatch(
      /"lt__others", which belongs to plugin "@acme\/later"/
    );
  });
});
