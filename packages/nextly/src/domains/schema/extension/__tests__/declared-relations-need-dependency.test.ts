/**
 * A plugin's own table naming another plugin's table, by a relation, a
 * `ref()` column or a foreign key, needs that plugin among its dependencies.
 *
 * The dependency is what orders the target's migrations first and keeps the
 * target installed while the relation needs it. A relation added to another
 * owner's table was already held to it; one declared on the plugin's own
 * table was not, so it compiled, and the first query through it (or the
 * target's uninstall) found the table gone. Refused at startup now, naming
 * the edge's table, its target and the plugin to depend on.
 *
 * Each table's own foreign key also carries a relation edge, as a `ref()`
 * column does, so a key is queryable with `with` without declaring it twice.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { getTableName, type Table } from "drizzle-orm";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { staticRelationTables } from "../../../../database/schema-registry";
import { NextlyError } from "../../../../errors/nextly-error";
import { buildExtensionSchema } from "../build-extension-schema";
import { toDrizzleTable } from "../compile";
import { col, defineTable, type TableDefinition } from "../dsl";

beforeAll(async () => {
  await loadDialectTables("postgresql");
});

const FORMS = "@acme/forms";
const REPORTS = "@acme/reports";

const submissions = defineTable("submissions", { id: col.id() });

function compile(
  reportTables: TableDefinition[],
  options: {
    dependsOn?: string[];
    entities?: Parameters<typeof buildExtensionSchema>[0]["entities"];
  } = {}
) {
  return buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users"],
    entities: options.entities ?? [],
    pluginPrefixes: new Map([
      [FORMS, "fm"],
      [REPORTS, "rp"],
    ]),
    dependencies: new Map([[REPORTS, new Set(options.dependsOn ?? [])]]),
    plugins: [
      { owner: { kind: "plugin", id: FORMS }, tables: [submissions] },
      { owner: { kind: "plugin", id: REPORTS }, tables: reportTables },
    ],
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

/** A report row pointing at a submission, through `how`. */
const reportBy = {
  relation: defineTable(
    "rows",
    { id: col.id(), submissionId: col.varchar(36) },
    {
      relations: [
        {
          name: "submission",
          kind: "one",
          targetTable: "fm__submissions",
          fromColumn: "submissionId",
        },
      ],
    }
  ),
  ref: defineTable("rows", {
    id: col.id(),
    submissionId: col.ref("fm__submissions"),
  }),
  foreignKey: defineTable(
    "rows",
    { id: col.id(), submissionId: col.varchar(36) },
    {
      foreignKeys: [
        {
          columns: ["submissionId"],
          references: { table: "fm__submissions", columns: ["id"] },
        },
      ],
    }
  ),
};

describe.each(Object.entries(reportBy))(
  "a plugin's own table naming another plugin's table by %s",
  (how, table) => {
    it("is refused at startup without a dependency, naming the edge and the plugin", async () => {
      const message = await refusal(() => compile([table]));
      // A key is judged with every declared key, by the migration streams'
      // order; a relation, which no stream carries, by the draft.
      expect(message).toMatch(
        how === "foreignKey"
          ? /references "fm__submissions", a table plugin "@acme\/forms" creates, and plugin "@acme\/reports" does not declare a dependency on it/
          : /plugin "@acme\/reports" declares on "rp__rows" points at "fm__submissions", which belongs to plugin "@acme\/forms"\. Name "@acme\/forms" in dependsOn/
      );
    });

    it("control: compiles once the plugin depends on the target's owner", async () => {
      const built = await compile([table], { dependsOn: [FORMS] });
      expect(
        built.relations.get("rp__rows")?.map(edge => edge.targetTable)
      ).toEqual(["fm__submissions"]);
    });
  }
);

describe("a plugin's own table naming a collection another plugin declared", () => {
  const rows = defineTable("rows", {
    id: col.id(),
    postId: col.ref("dc_posts"),
  });
  const posts = (ownerPlugin?: string) => [
    {
      name: "dc_posts",
      slug: "posts",
      entityKind: "collection" as const,
      ...(ownerPlugin ? { ownerPlugin } : {}),
      columns: [{ name: "id", kind: "varchar", nullable: false }],
    },
  ];

  it("is refused without a dependency on that plugin", async () => {
    expect(
      await refusal(() => compile([rows], { entities: posts(FORMS) }))
    ).toMatch(
      /points at "dc_posts", which belongs to the collection "posts", declared by plugin "@acme\/forms"\. Name "@acme\/forms" in dependsOn/
    );
  });

  it("control: the app's collection needs no dependency", async () => {
    const built = await compile([rows], { entities: posts() });
    expect(built.relations.get("rp__rows")?.[0]?.targetTable).toBe("dc_posts");
  });
});

describe("a table's own foreign key", () => {
  it("carries a one-edge named for its column, joining the referenced column", async () => {
    const tables = [
      defineTable(
        "rows",
        { id: col.id(), code: col.varchar(20), ownerCode: col.varchar(20) },
        {
          indexes: [{ columns: ["code"], unique: true }],
          foreignKeys: [
            {
              columns: ["ownerCode"],
              references: { table: "rp__rows", columns: ["code"] },
            },
          ],
        }
      ),
    ];
    const built = await compile(tables);
    expect(built.relations.get("rp__rows")).toEqual([
      {
        key: "ownerCodeRef",
        kind: "one",
        fromColumn: "ownerCode",
        targetTable: "rp__rows",
        toColumn: "code",
      },
    ]);
  });

  it("carries none beside a declared relation over the same column", async () => {
    const table = defineTable(
      "rows",
      { id: col.id(), parentId: col.varchar(36, { nullable: true }) },
      {
        foreignKeys: [
          {
            columns: ["parentId"],
            references: { table: "rp__rows", columns: ["id"] },
          },
        ],
        relations: [
          {
            name: "up",
            kind: "one",
            targetTable: "rp__rows",
            fromColumn: "parentId",
          },
        ],
      }
    );
    const built = await compile([table]);
    expect(built.relations.get("rp__rows")?.map(edge => edge.key)).toEqual([
      "up",
    ]);
  });

  it("carries none for a key over two columns, which no edge can join", async () => {
    const table = defineTable(
      "rows",
      {
        id: col.id(),
        a: col.varchar(20),
        b: col.varchar(20),
        pa: col.varchar(20),
        pb: col.varchar(20),
      },
      {
        indexes: [{ columns: ["a", "b"], unique: true }],
        foreignKeys: [
          {
            columns: ["pa", "pb"],
            references: { table: "rp__rows", columns: ["a", "b"] },
          },
        ],
      }
    );
    const built = await compile([table]);
    expect(built.relations.get("rp__rows")).toBeUndefined();
  });

  it("names a core target by the key the registry holds it under", async () => {
    // `dynamic_collections` is the SQL name; the registry composes the core
    // tables under their bundle keys, so an edge naming the SQL name would
    // not resolve.
    const table = defineTable(
      "rows",
      { id: col.id(), collectionId: col.shortText() },
      {
        foreignKeys: [
          {
            columns: ["collectionId"],
            references: { table: "dynamic_collections", columns: ["id"] },
          },
        ],
      }
    );
    const built = await compile([table]);
    const core = staticRelationTables("postgresql");
    const [edge] = built.relations.get("rp__rows") ?? [];
    expect(edge?.targetTable).not.toBe("dynamic_collections");
    expect(getTableName(core[edge?.targetTable ?? ""] as Table)).toBe(
      "dynamic_collections"
    );
    // The key itself keeps the SQL name it is created with.
    expect(
      built.specs.find(spec => spec.name === "rp__rows")?.foreignKeys?.[0]
        ?.referencesTable
    ).toBe("dynamic_collections");
  });

  it("carries none where a column already holds the edge's name", async () => {
    const table = defineTable(
      "rows",
      {
        id: col.id(),
        code: col.varchar(20),
        ownerCode: col.varchar(20),
        ownerCodeRef: col.shortText({ nullable: true }),
      },
      {
        indexes: [{ columns: ["code"], unique: true }],
        foreignKeys: [
          {
            columns: ["ownerCode"],
            references: { table: "rp__rows", columns: ["code"] },
          },
        ],
      }
    );
    const built = await compile([table]);
    expect(built.relations.get("rp__rows")).toBeUndefined();
  });

  it("carries none to a table the registry will not hold", async () => {
    // A table outside Nextly: the key is the database's to judge, and an edge
    // to it would fail the boot's check that every relation resolves.
    const table = defineTable(
      "rows",
      { id: col.id(), accountId: col.shortText() },
      {
        foreignKeys: [
          {
            columns: ["accountId"],
            references: { table: "legacy_accounts", columns: ["id"] },
          },
        ],
      }
    );
    const built = await compile([table]);
    expect(built.relations.get("rp__rows")).toBeUndefined();
    expect(
      built.specs.find(spec => spec.name === "rp__rows")?.foreignKeys
    ).toHaveLength(1);
  });

  it("follows a target an afterDrizzle hook re-keyed, by the column it names", async () => {
    const customers = defineTable("app_customers", { id: col.id() });
    const orders = defineTable(
      "app_orders",
      { id: col.id(), customerId: col.shortText() },
      {
        foreignKeys: [
          {
            columns: ["customerId"],
            references: { table: "app_customers", columns: ["id"] },
          },
        ],
      }
    );
    const build = (
      afterDrizzle: Parameters<typeof buildExtensionSchema>[0]["afterDrizzle"]
    ) =>
      buildExtensionSchema({
        dialect: "postgresql",
        coreTableNames: [],
        entities: [],
        pluginPrefixes: new Map(),
        plugins: [],
        app: {
          owner: { kind: "app" },
          extend: [
            ({ schema }) => {
              schema.addTable(customers);
              schema.addTable(orders);
            },
          ],
        },
        afterDrizzle,
      });
    const declared = (await build([])).tables.find(
      t => t.name === "app_customers"
    )!;
    // The same SQL column, held under another property.
    const built = await build([
      () => ({
        app_customers: toDrizzleTable(
          {
            ...declared,
            columns: declared.columns.map(c =>
              c.name === "id" ? { ...c, key: "pk" } : c
            ),
          },
          "postgresql"
        ),
      }),
    ]);
    expect(built.relations.get("app_orders")).toEqual([
      {
        key: "customer",
        kind: "one",
        fromColumn: "customerId",
        targetTable: "app_customers",
        toColumn: "pk",
      },
    ]);
  });

  it("carries none to a column other than id on a collection, which the compile cannot check", async () => {
    // The app's table: a plugin's key to a collection's table is refused,
    // since the app's stream creates that table after every plugin's.
    const table = defineTable(
      "app_rows",
      { id: col.id(), postSlug: col.varchar(20), postId: col.varchar(36) },
      {
        foreignKeys: [
          {
            columns: ["postSlug"],
            references: { table: "dc_posts", columns: ["slug"] },
          },
          // CONTROL: the collection's id is joined, as a ref() column's is.
          {
            columns: ["postId"],
            references: { table: "dc_posts", columns: ["id"] },
          },
        ],
      }
    );
    const built = await buildExtensionSchema({
      dialect: "postgresql",
      coreTableNames: ["users"],
      entities: [
        {
          name: "dc_posts",
          slug: "posts",
          entityKind: "collection",
          columns: [
            { name: "id", kind: "varchar", nullable: false },
            { name: "slug", kind: "varchar", nullable: false },
          ],
        },
      ],
      pluginPrefixes: new Map(),
      plugins: [],
      app: {
        owner: { kind: "app" },
        extend: [({ schema }) => schema.addTable(table)],
      },
    });
    expect(built.relations.get("app_rows")).toEqual([
      {
        key: "post",
        kind: "one",
        fromColumn: "postId",
        targetTable: "dc_posts",
      },
    ]);
  });
});
