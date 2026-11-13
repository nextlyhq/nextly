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

import { loadDialectTables } from "../../../../database/dialect-tables";
import { NextlyError } from "../../../../errors/nextly-error";
import { buildExtensionSchema } from "../build-extension-schema";
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
  (_how, table) => {
    it("is refused at startup without a dependency, naming the edge and the plugin", async () => {
      const message = await refusal(() => compile([table]));
      expect(message).toMatch(
        /plugin "@acme\/reports" declares on "rp__rows" points at "fm__submissions", which belongs to plugin "@acme\/forms"\. Name "@acme\/forms" in dependsOn/
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
    expect(table.relations.map(rel => rel.name)).toEqual(["up"]);
  });

  it("carries none for a key over two columns, which no edge can join", () => {
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
    expect(table.relations).toEqual([]);
  });
});
