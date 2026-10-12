/**
 * A table an `afterDrizzle` hook reshapes keeps what its declaration says and
 * the hook did not change.
 *
 * The usual reason for the hook is to widen one column, and a Drizzle table
 * cannot be edited — it has to be rebuilt. The rebuilt table carries neither
 * the declared indexes, nor the checks and foreign keys that PostgreSQL and
 * MySQL apply as separate statements, nor the spec-only `autoIncrement`. A
 * spec re-derived from it read all of those as absent, so the next push or
 * generated migration dropped them.
 *
 * Each hook here is built with the compiler's own `toDrizzleTable` from the
 * declaration with one change applied, so every column but the changed one is
 * restated exactly — the faithful version of what an app author does.
 */
import { index, pgTable, varchar } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { buildExtensionSchema } from "../build-extension-schema";
import { toDrizzleTable } from "../compile";
import { col, defineTable } from "../dsl";
import type { ExtensionColumn, ExtensionTable } from "../types";

type Dialect = "postgresql" | "mysql";

const customers = defineTable("app_customers", { id: col.id() });
const orders = defineTable(
  "app_orders",
  {
    id: col.serial(),
    status: col.enum(["open", "closed"]),
    total: col.integer(),
    customerId: col.varchar(36),
  },
  {
    indexes: [{ columns: ["total"] }],
    foreignKeys: [
      {
        columns: ["customerId"],
        references: { table: "app_customers", columns: ["id"] },
      },
    ],
    relations: [
      {
        name: "customer",
        kind: "one",
        targetTable: "app_customers",
        fromColumn: "customerId",
        toColumn: "id",
      },
    ],
  }
);

function build(
  dialect: Dialect,
  afterDrizzle: Parameters<typeof buildExtensionSchema>[0]["afterDrizzle"]
) {
  return buildExtensionSchema({
    dialect,
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
}

/** The compiled declaration of `app_orders`, as the hook would rebuild it. */
async function declaration(dialect: Dialect): Promise<ExtensionTable> {
  const first = await build(dialect, []);
  const table = first.tables.find(t => t.name === "app_orders");
  if (!table) throw new Error("app_orders was not compiled");
  return table;
}

/** A hook returning `app_orders` rebuilt from `edit(declaration)`. */
function rebuilding(
  dialect: Dialect,
  declared: ExtensionTable,
  edit: (columns: ExtensionColumn[]) => ExtensionColumn[]
) {
  return () => ({
    app_orders: toDrizzleTable(
      { ...declared, columns: edit([...declared.columns]), indexes: [] },
      dialect
    ),
  });
}

const widenTotal = (columns: ExtensionColumn[]) =>
  columns.map(c =>
    c.name === "total" ? { ...c, kind: "bigint" as const } : c
  );

describe.each(["postgresql", "mysql"] as const)(
  "a table an afterDrizzle hook widened, on %s",
  dialect => {
    it("keeps its index, enum check, foreign key and serial key", async () => {
      const declared = await declaration(dialect);
      const baseline = (await build(dialect, [])).specs.find(
        s => s.name === "app_orders"
      )!;
      const built = await build(dialect, [
        rebuilding(dialect, declared, widenTotal),
      ]);
      const spec = built.specs.find(s => s.name === "app_orders")!;

      // The change itself arrived: the migration model follows the hook.
      const before = baseline.columns.find(c => c.name === "total")!;
      const after = spec.columns.find(c => c.name === "total")!;
      expect(after.type).not.toBe(before.type);

      // ...and nothing the hook did not touch was lost.
      expect(spec.indexes?.map(i => i.name)).toEqual(
        baseline.indexes?.map(i => i.name)
      );
      expect(spec.indexes?.length).toBeGreaterThan(0);
      expect(spec.checks?.map(c => c.name)).toEqual(
        baseline.checks?.map(c => c.name)
      );
      expect(spec.checks?.map(c => c.name)).toContain(
        "ck_app_orders_status_enum"
      );
      expect(spec.foreignKeys).toEqual(baseline.foreignKeys);
      expect(spec.foreignKeys?.length).toBe(1);
      expect(spec.columns.find(c => c.name === "id")?.autoIncrement).toBe(true);
    });

    it("drops the enum check of a column the hook removed", async () => {
      const declared = await declaration(dialect);
      const built = await build(dialect, [
        rebuilding(dialect, declared, columns =>
          columns.filter(c => c.name !== "status")
        ),
      ]);

      const spec = built.specs.find(s => s.name === "app_orders")!;
      expect(spec.columns.map(c => c.name)).not.toContain("status");
      expect(spec.checks?.map(c => c.name) ?? []).not.toContain(
        "ck_app_orders_status_enum"
      );
      // The control: the foreign key, whose column is still there, stays.
      expect(spec.foreignKeys?.length).toBe(1);
    });
  }
);

describe("relation edges on a table a hook rebuilt", () => {
  it("follow the keys of the table the hook returned", async () => {
    const declared = await declaration("postgresql");
    // Keyed by SQL name, as a hand-written `pgTable` usually is.
    const bySqlName = (columns: ExtensionColumn[]) =>
      widenTotal(columns).map(c => ({ ...c, key: c.name }));

    const built = await build("postgresql", [
      rebuilding("postgresql", declared, bySqlName),
    ]);

    const [edge] = built.relations.get("app_orders") ?? [];
    expect(edge?.fromColumn).toBe("customer_id");
  });

  it("refuse a hook that removed the column an edge joins on", async () => {
    const declared = await declaration("postgresql");
    const refused = await build("postgresql", [
      rebuilding("postgresql", declared, columns =>
        columns.filter(c => c.name !== "customer_id")
      ),
    ]).catch((error: unknown) => error);

    const errors =
      (refused as { publicData?: { errors?: { message?: string }[] } })
        ?.publicData?.errors ?? [];
    expect(errors.map(e => e.message).join(" ")).toMatch(
      /customer_id.*app_orders\.customer/
    );
  });

  it("keep the authored key when the hook kept it", async () => {
    const declared = await declaration("postgresql");
    const built = await build("postgresql", [
      rebuilding("postgresql", declared, widenTotal),
    ]);

    const [edge] = built.relations.get("app_orders") ?? [];
    expect(edge?.fromColumn).toBe("customerId");
  });
});

describe("a declared check on a column a hook removed", () => {
  /** `app_ledger` with the given checks, and a hook that drops `amount`. */
  async function dropAmount(checks: { name: string; sql: string }[]) {
    const ledger = defineTable(
      "app_ledger",
      { id: col.id(), amount: col.integer(), kind: col.shortText() },
      { checks }
    );
    const declareLedger = {
      owner: { kind: "app" as const },
      extend: [
        ({ schema }: { schema: { addTable(definition: unknown): void } }) => {
          schema.addTable(ledger);
        },
      ],
    };
    const first = await buildExtensionSchema({
      dialect: "postgresql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map(),
      plugins: [],
      app: declareLedger as never,
    });
    const declared = first.tables.find(t => t.name === "app_ledger")!;
    return buildExtensionSchema({
      dialect: "postgresql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map(),
      plugins: [],
      app: declareLedger as never,
      afterDrizzle: [
        () => ({
          app_ledger: toDrizzleTable(
            {
              ...declared,
              columns: declared.columns.filter(c => c.name !== "amount"),
            },
            "postgresql"
          ),
        }),
      ],
    });
  }

  it("is refused, naming the check and the column", async () => {
    const refused = await dropAmount([
      { name: "positive_amount", sql: "amount >= 0" },
    ]).catch((error: unknown) => error);

    const errors =
      (refused as { publicData?: { errors?: { message?: string }[] } })
        ?.publicData?.errors ?? [];
    expect(errors.map(e => e.message).join(" ")).toMatch(
      /removed column "amount".*check "ck_app_ledger_positive_amount"/
    );
  });

  it("is not refused for a check that names it only inside a string", async () => {
    // The control, and why the SQL is read with the scanner: the word appears,
    // but as a value the check compares against rather than as a column.
    const built = await dropAmount([
      { name: "kind_not_amount", sql: "kind <> 'amount'" },
    ]);
    const spec = built.specs.find(s => s.name === "app_ledger")!;
    expect(spec.checks?.map(c => c.name)).toEqual([
      "ck_app_ledger_kind_not_amount",
    ]);
    expect(spec.columns.map(c => c.name)).not.toContain("amount");
  });
});

describe("an expression index on a column a hook removed", () => {
  const searched = defineTable(
    "app_searched",
    {
      id: col.id(),
      email: col.shortText(),
      code: col.shortText(),
      lower: col.shortText(),
    },
    {
      indexes: [
        { columns: [], expression: "lower(email)", name: "idx_searched_email" },
      ],
    }
  );
  const buildSearched = (
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
        extend: [({ schema }) => schema.addTable(searched)],
      },
      afterDrizzle,
    });
  const without = async (column: string) => {
    const declared = (await buildSearched([])).tables.find(
      t => t.name === "app_searched"
    )!;
    const built = await buildSearched([
      () => ({
        app_searched: toDrizzleTable(
          {
            ...declared,
            columns: declared.columns.filter(c => c.name !== column),
            indexes: [],
          },
          "postgresql"
        ),
      }),
    ]);
    return built.specs.find(s => s.name === "app_searched")!;
  };

  it("goes with the column, as a plain index does", async () => {
    // Kept, it would reach the migration as an index on a missing column.
    expect((await without("email")).indexes?.map(i => i.name)).toEqual([]);
  });

  it("stays when the removed column shares a name with a function it calls", async () => {
    expect((await without("lower")).indexes?.map(i => i.name)).toEqual([
      "idx_searched_email",
    ]);
  });

  it("stays when the hook removed a column it does not read", async () => {
    expect((await without("code")).indexes?.map(i => i.name)).toEqual([
      "idx_searched_email",
    ]);
  });
});

describe("an index an afterDrizzle hook adds", () => {
  /** A hook giving `app_customers` an index named `name`. */
  const indexing = (name: string) => () => ({
    app_customers: pgTable(
      "app_customers",
      { id: varchar("id", { length: 36 }).primaryKey() },
      t => [index(name).on(t.id)]
    ),
  });

  /** The paths the build refuses with, or [] when it succeeds. */
  const refusedAt = async (
    afterDrizzle: Parameters<typeof build>[1]
  ): Promise<string[]> => {
    try {
      await build("postgresql", afterDrizzle);
      return [];
    } catch (error) {
      if (!(error instanceof NextlyError)) throw error;
      const data = error.publicData as { errors?: { path: string }[] };
      return (data.errors ?? []).map(issue => issue.path);
    }
  };

  it("is refused under another table's index name, as a declared one is", async () => {
    // PostgreSQL and SQLite hold index names per schema, so the second
    // `CREATE INDEX` of one name would leave a table without its index.
    const first = await build("postgresql", []);
    const taken = first.specs.find(spec => spec.name === "app_orders")
      ?.indexes?.[0]?.name;
    expect(taken).toBeDefined();
    // Named at the second table to claim it, in the order the tables build.
    expect(await refusedAt([indexing(taken ?? "")])).toEqual([
      "app_orders.indexes",
    ]);
  });

  it("is kept under a name of its own", async () => {
    // The control: the same hook, an unused name.
    expect(await refusedAt([indexing("idx_app_customers_lookup")])).toEqual([]);
  });
});

describe("a hook making a set-null key's column NOT NULL", () => {
  const owners = defineTable("app_owners", { id: col.id() });
  const pets = defineTable(
    "app_pets",
    { id: col.id(), ownerId: col.varchar(36, { nullable: true }) },
    {
      foreignKeys: [
        {
          columns: ["ownerId"],
          references: { table: "app_owners", columns: ["id"] },
          onDelete: "set null",
        },
      ],
    }
  );
  const buildPets = (
    afterDrizzle: Parameters<typeof buildExtensionSchema>[0]["afterDrizzle"]
  ) =>
    buildExtensionSchema({
      dialect: "mysql",
      coreTableNames: [],
      entities: [],
      pluginPrefixes: new Map(),
      plugins: [],
      app: {
        owner: { kind: "app" },
        extend: [
          ({ schema }) => {
            schema.addTable(owners);
            schema.addTable(pets);
          },
        ],
      },
      afterDrizzle,
    });
  const rebuildPets = async (nullable: boolean) => {
    const declared = (await buildPets([])).tables.find(
      t => t.name === "app_pets"
    )!;
    return () => ({
      app_pets: toDrizzleTable(
        {
          ...declared,
          columns: declared.columns.map(c =>
            c.name === "owner_id" ? { ...c, nullable } : c
          ),
        },
        "mysql"
      ),
    });
  };

  it("is refused, as the declaration would be, and a hook keeping it nullable is not", async () => {
    const error = await buildPets([await rebuildPets(false)]).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(NextlyError);
    const issues = (error as NextlyError).publicData as {
      errors: { path: string; message: string }[];
    };
    expect(issues.errors.map(issue => issue.path)).toEqual([
      "app_pets.foreignKeys",
    ]);
    expect(issues.errors[0]?.message).toContain(
      'onDelete is "set null", and its column "owner_id" is not nullable'
    );

    const kept = await buildPets([await rebuildPets(true)]);
    expect(
      kept.specs.find(s => s.name === "app_pets")?.foreignKeys?.[0]?.onDelete
    ).toBe("set null");
  });
});
