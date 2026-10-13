/**
 * A declared table's relation is checked once every table is registered, at
 * boot: a relation to a Builder-made collection boots, and one naming a table
 * that does not exist stops the boot, naming the relation.
 *
 * The compiler cannot judge a relation's target table, because a Builder-made
 * collection reaches the registry only at runtime, from its registry row. So
 * the registry assembles the relations at boot, after loading those rows, and
 * a misspelled target is refused there rather than failing the first
 * relational query. SQLite only: the question is the registry's, which is the
 * same object on every dialect; the boot is what is under test.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import type { SchemaRegistry } from "../../../database/schema-registry";
import { container } from "../../../di/container";
import { ensureFirstRunSetup } from "../../../init/first-run";
import { seedBuilderCollection } from "../../../plugins/__tests__/seed-builder-entity";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

import { col, defineTable } from "./dsl";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A plugin whose table relates to `targetTable` by its `productId` column. */
function pluginRelatingTo(targetTable: string) {
  const links = defineTable(
    "links",
    { id: col.id(), productId: col.shortText({ nullable: true }) },
    {
      relations: [
        { name: "product", kind: "one", targetTable, fromColumn: "productId" },
      ],
    }
  );
  return definePlugin({
    name: "relation-targets-fixture",
    version: "0.0.0",
    nextly: "*",
    contributes: { schema: { prefix: "rt", tables: [links] } },
  });
}

/**
 * An in-memory database whose system tables exist and which holds a
 * Builder-made `products` collection, as an install does once someone has
 * made one in the Builder.
 */
async function withBuilderProducts() {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
  await ensureFirstRunSetup({ adapter, logger: silentLogger });
  await seedBuilderCollection(adapter, {
    slug: "products",
    fields: [{ name: "name", type: "text" }],
  });
  return adapter;
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("a declared table's relation targets, at boot", () => {
  it("boots with a relation to a Builder-made collection (control)", async () => {
    current = await createTestNextly({
      adapter: await withBuilderProducts(),
      plugins: [pluginRelatingTo("dc_products")],
    });
    // Assembled at boot and kept: the relation is there for the first query.
    const registry = container.get<SchemaRegistry>("schemaRegistry");
    expect(
      registry.getRelations().rt__links?.relations.product?.targetTableName
    ).toBe("dc_products");
  });

  it("refuses to boot with a relation to a table that does not exist, naming it", async () => {
    const adapter = await withBuilderProducts();
    await expect(
      createTestNextly({
        adapter,
        plugins: [pluginRelatingTo("dc_prodcuts")],
      })
    ).rejects.toMatchObject({
      code: "NEXTLY_SCHEMA_RELATION_UNRESOLVED",
      logContext: { relations: ["rt__links.product"] },
    });
  });
});
