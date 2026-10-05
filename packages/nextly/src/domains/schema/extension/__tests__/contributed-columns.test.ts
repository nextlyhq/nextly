/**
 * A column contributed to a table its owner did not declare has to ARRIVE.
 *
 * `extendTable({ columns })` is permitted on an entity, on an extendable core
 * table, and on another owner's table — it is what C3 and C7 are for. The
 * column was validated, marked hidden, recorded per element, collected into
 * `entityColumns`, and then read by nothing: absent from every `TableSpec`,
 * so the desired snapshot never proposed creating it, and absent from every
 * runtime table, so `ctx.db` could not have used it if it had existed.
 *
 * The draft test states the contract this file enforces: "the column reaches
 * the runtime table (so push and SQLite rebuilds keep it) and is marked
 * hidden (so no entry API returns it). Neither half alone would be safe."
 * Only the second half was asserted anywhere.
 */
import { getColumns } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import { stripServerOnlyColumns } from "../../../../shared/lib/password-fields";
import { generateRuntimeSchema } from "../../services/runtime-schema-generator";
import {
  clearActiveExtensionSchema,
  setActiveExtensionSchema,
} from "../active-schema";
import {
  buildExtensionSchema,
  type ExtensionSchemaInput,
} from "../build-extension-schema";
import { toColumnSpec } from "../compile";
import type { SchemaHook } from "../draft";
import { col } from "../dsl";
import { withEntityContributions } from "../entity-contributions";

function input(extend: readonly SchemaHook[]): ExtensionSchemaInput {
  return {
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [
      {
        name: "dc_posts",
        slug: "posts",
        entityKind: "collection",
        columns: [
          { name: "id", kind: "varchar", nullable: false },
          { name: "title", kind: "text", nullable: true },
        ],
      },
    ],
    pluginPrefixes: new Map([["fx", "fx"]]),
    plugins: [],
    app: { owner: { kind: "app" }, extend },
  };
}

const addsSearchVector = input([
  ({ schema }) => {
    schema.extendTable("dc_posts", {
      columns: { searchVector: col.text({ nullable: true }) },
    });
  },
]);

afterEach(() => {
  clearActiveExtensionSchema();
});

describe("a column contributed to an entity table", () => {
  it("reaches the entity's DESIRED spec, so the push creates it", async () => {
    const schema = await buildExtensionSchema(addsSearchVector);

    // Through the helper dev push and the migration stream both apply.
    const spec = withEntityContributions(
      buildDesiredTableFromFields(
        "dc_posts",
        [{ name: "title", type: "text" }],
        "postgresql",
        { builtBy: "codeFirst" }
      ),
      schema,
      undefined,
      "postgresql"
    );

    expect(spec.columns.map(c => c.name)).toContain("search_vector");
  });

  it("reaches the entity's RUNTIME table, so ctx.db can read it", async () => {
    const schema = await buildExtensionSchema(addsSearchVector);
    setActiveExtensionSchema("postgresql", schema);

    // No explicit option: the generator is called from roughly twenty-five
    // places, and the point of the default is that none of them has to know.
    const { table } = generateRuntimeSchema(
      "dc_posts",
      [{ name: "title", type: "text" }] as never,
      "postgresql"
    );

    expect(Object.keys(getColumns(table as never))).toContain("search_vector");
  });

  it("keys the runtime column by its SQL name, as an owned table does", async () => {
    // `toDrizzleTable` keys an extension table's own columns by SQL name. A
    // different key here would give one column two handles depending on which
    // table it was read from.
    const schema = await buildExtensionSchema(addsSearchVector);
    setActiveExtensionSchema("postgresql", schema);

    const { table } = generateRuntimeSchema(
      "dc_posts",
      [] as never,
      "postgresql"
    );
    const columns = getColumns(table as never) as Record<
      string,
      { name: string }
    >;

    expect(columns["search_vector"]?.name).toBe("search_vector");
  });

  it("is STRIPPED from an entry, having reached the row", async () => {
    // The other half of the contract, and the half the first two make load
    // bearing: the column is on the table now, so `select()` returns it in
    // every row, and an entry is where it must not appear.
    const schema = await buildExtensionSchema(addsSearchVector);
    setActiveExtensionSchema("postgresql", schema);

    const entry: Record<string, unknown> = {
      id: "1",
      title: "hello",
      created_by: "u1",
      search_vector: "hello",
    };
    stripServerOnlyColumns(entry, "dc_posts");

    expect(entry).toEqual({ id: "1", title: "hello" });
  });

  it("strips it from THIS table only", async () => {
    // A contributed name is not namespaced, so a single global set would take
    // a legitimate field of the same name off an unrelated entity.
    const schema = await buildExtensionSchema(addsSearchVector);
    setActiveExtensionSchema("postgresql", schema);

    const other: Record<string, unknown> = { id: "1", search_vector: "mine" };
    stripServerOnlyColumns(other, "dc_articles");

    expect(other["search_vector"]).toBe("mine");
  });

  it("moves the FINGERPRINT, so dev push has something to act on", async () => {
    const without = await buildExtensionSchema(input([]));
    const with_ = await buildExtensionSchema(addsSearchVector);

    // A fingerprint that ignored contributed columns reported "nothing
    // changed" for a change the push has to make, so the column waited for an
    // unrelated edit before it was ever created.
    expect(with_.fingerprint).not.toBe(without.fingerprint);
  });

  it("does not displace a column the entity already has", async () => {
    // The guard: a contributed name colliding with a system or field column
    // must not silently override it. The draft refuses the collision on a
    // table it can see; this is the belt for one it cannot, applied by the
    // helper dev push and the migration stream share.
    const spec = withEntityContributions(
      buildDesiredTableFromFields(
        "dc_posts",
        [{ name: "title", type: "text" }],
        "postgresql",
        { builtBy: "codeFirst" }
      ),
      {
        entityColumns: new Map([
          [
            "dc_posts",
            [
              {
                key: "title",
                name: "title",
                kind: "varchar",
                length: 3,
                nullable: false,
                hidden: true,
              },
            ],
          ],
        ]),
        entityIndexes: new Map(),
      },
      undefined,
      "postgresql"
    );

    expect(spec.columns.filter(c => c.name === "title")).toHaveLength(1);
    expect(spec.columns.find(c => c.name === "title")?.type).not.toBe(
      "varchar(3)"
    );
  });
});

describe("a defaulted column contributed to an entity table", () => {
  /**
   * One contribution on each kind of entity table, for one dialect: a
   * collection and a Single through the entity generator, a component through
   * the field-group service — the three builders drizzle-kit is handed.
   */
  const contributesDefaults = (dialect: SupportedDialect) => ({
    ...input([
      ({ schema }) => {
        for (const table of ["dc_posts", "single_site", "comp_hero"]) {
          schema.extendTable(table, {
            columns: { reviewState: col.shortText({ default: "draft" }) },
          });
        }
      },
    ]),
    dialect,
    entities: [
      ...input([]).entities,
      {
        name: "single_site",
        slug: "site",
        entityKind: "single" as const,
        columns: [{ name: "id", kind: "varchar", nullable: false }],
      },
      {
        name: "comp_hero",
        slug: "hero",
        entityKind: "component" as const,
        columns: [{ name: "id", kind: "varchar", nullable: false }],
      },
    ],
  });

  /** The text of a `sql.raw()` default, as the DDL will carry it. */
  const rawSql = (value: unknown): string =>
    (value as { queryChunks: { value: string[] }[] }).queryChunks
      .map(chunk => chunk.value.join(""))
      .join("");

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "carries its declared default into every runtime builder on %s",
    async dialect => {
      // The desired spec keeps the default; a runtime table without it is the
      // table drizzle-kit creates, so the two described different columns —
      // an `ADD COLUMN ... NOT NULL` with no default on a populated table.
      const schema = await buildExtensionSchema(contributesDefaults(dialect));
      setActiveExtensionSchema(dialect, schema);
      const [contributed] = schema.entityColumns.get("dc_posts") ?? [];
      const expected = toColumnSpec(contributed, dialect).default;
      expect(expected).toBeDefined();

      const tables = [
        generateRuntimeSchema("dc_posts", [] as never, dialect).table,
        generateRuntimeSchema("single_site", [] as never, dialect).table,
        new FieldGroupSchemaService(dialect).generateRuntimeSchema(
          "comp_hero",
          [],
          { typeColumn: "_component_type" }
        ),
      ];
      for (const table of tables) {
        const column = (
          getColumns(table as never) as Record<
            string,
            { hasDefault: boolean; notNull: boolean; default: unknown }
          >
        )["review_state"];
        expect(column?.notNull).toBe(true);
        expect(column?.hasDefault).toBe(true);
        expect(rawSql(column?.default)).toBe(expected);
      }
    }
  );
});
