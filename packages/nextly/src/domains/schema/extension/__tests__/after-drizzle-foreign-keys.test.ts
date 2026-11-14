/**
 * Every declared foreign key is checked at both ends once the app's
 * `afterDrizzle` hooks have run.
 *
 * The declaration's keys are judged against the declared tables, before any
 * hook sees them. A hook may then rebuild a table without a column a key
 * stands on or points at, or drop a table a key points at. The key used to
 * be dropped from the migration model without a word when its own column
 * went, and kept, pointing at nothing, when its target went: the first
 * leaves a constraint the author declared missing from every database, the
 * second fails when the migration applies. Each is refused, naming the key.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { buildExtensionSchema } from "../build-extension-schema";
import { toDrizzleTable } from "../compile";
import { col, defineTable } from "../dsl";
import type { ExtensionColumn, ExtensionTable } from "../types";

type Dialect = "postgresql" | "mysql" | "sqlite";

const customers = defineTable(
  "app_customers",
  { id: col.id(), code: col.varchar(20), note: col.text({ nullable: true }) },
  { indexes: [{ columns: ["code"], unique: true }] }
);
const orders = defineTable(
  "app_orders",
  {
    id: col.serial(),
    total: col.integer(),
    customerCode: col.varchar(20),
  },
  {
    foreignKeys: [
      {
        columns: ["customerCode"],
        references: { table: "app_customers", columns: ["code"] },
      },
    ],
  }
);

type Hooks = Parameters<typeof buildExtensionSchema>[0]["afterDrizzle"];

function build(dialect: Dialect, afterDrizzle: Hooks) {
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

/** A hook returning `table` rebuilt from its declaration, with `edit` applied. */
async function rebuilding(
  dialect: Dialect,
  table: string,
  edit: (columns: ExtensionColumn[]) => ExtensionColumn[]
): Promise<NonNullable<Hooks>[number]> {
  const declared = (await build(dialect, [])).tables.find(
    t => t.name === table
  ) as ExtensionTable;
  return () => ({
    [table]: toDrizzleTable(
      { ...declared, columns: edit([...declared.columns]), indexes: [] },
      dialect
    ),
  });
}

const without =
  (name: string) =>
  (columns: ExtensionColumn[]): ExtensionColumn[] =>
    columns.filter(column => column.name !== name);

async function refusal(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  if (!(error instanceof NextlyError)) {
    throw new Error(
      error === undefined
        ? "expected the build to refuse, and it succeeded"
        : `expected a NextlyError, got ${String(error)}`
    );
  }
  const data = error.publicData as { errors?: { message: string }[] };
  return data.errors?.map(e => e.message).join(" ") ?? "";
}

describe.each(["postgresql", "mysql", "sqlite"] as const)(
  "a declared foreign key after an afterDrizzle hook, on %s",
  dialect => {
    it("is refused when the hook removed its source column, naming the key and the column", async () => {
      const message = await refusal(
        build(dialect, [
          await rebuilding(dialect, "app_orders", without("customer_code")),
        ])
      );
      expect(message).toMatch(
        /removed column "customer_code" from "app_orders", which the foreign key "fk_app_orders_customer_code" declared on that table stands on/
      );
    });

    it("is refused when the hook removed its target column, naming the key and both tables", async () => {
      const message = await refusal(
        build(dialect, [
          await rebuilding(dialect, "app_customers", without("code")),
        ])
      );
      expect(message).toMatch(
        /removed column "code" from "app_customers", which the foreign key "fk_app_orders_customer_code" on "app_orders" references/
      );
    });

    it("is refused when the hook removed its target table, naming the key", async () => {
      const message = await refusal(
        build(dialect, [() => ({ app_customers: undefined })])
      );
      expect(message).toMatch(
        /removed the table "app_customers", which the foreign key "fk_app_orders_customer_code" on "app_orders" references/
      );
    });

    it("control: a hook that reshapes both ends and keeps the key's columns keeps the key", async () => {
      const widenTotal = (columns: ExtensionColumn[]) =>
        columns.map(c =>
          c.name === "total" ? { ...c, kind: "bigint" as const } : c
        );
      const built = await build(dialect, [
        await rebuilding(dialect, "app_orders", widenTotal),
        await rebuilding(dialect, "app_customers", without("note")),
      ]);
      const spec = built.specs.find(s => s.name === "app_orders");
      expect(spec?.foreignKeys?.map(fk => fk.name)).toEqual([
        "fk_app_orders_customer_code",
      ]);
      expect(
        built.specs
          .find(s => s.name === "app_customers")
          ?.columns.map(c => c.name)
      ).not.toContain("note");
    });

    it("control: a hook removing a table no key references is refused as a removal, not for a key", async () => {
      const message = await refusal(
        build(dialect, [() => ({ app_orders: undefined })])
      );
      expect(message).toMatch(/removed the table "app_orders"/);
      expect(message).not.toMatch(/foreign key/);
    });
  }
);
