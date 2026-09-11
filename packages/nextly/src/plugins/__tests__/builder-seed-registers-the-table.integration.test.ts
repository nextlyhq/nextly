/**
 * The Builder seed helpers leave a table the runtime can address.
 *
 * A create path registers the runtime table with the adapter's resolver right
 * after its DDL, so the table is usable in the process that made it. A seed
 * that only runs the DDL leaves a table every model-bound adapter call refuses
 * as unknown, while raw SQL still reaches it: the fixture then measures a
 * database no create path produces, and a write path that moves from raw SQL
 * to the query builder fails against it for a reason the production path does
 * not have.
 */
import { describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { createTestNextly } from "../test-nextly";
import {
  seedBuilderCollection,
  seedBuilderComponent,
  seedBuilderSingle,
} from "./seed-builder-entity";

describe("a Builder-seeded table is registered with the resolver", () => {
  it("addresses a collection, a single and a field group through the model", async () => {
    const handle = await createTestNextly();
    try {
      const adapter = handle.adapter as unknown as DrizzleAdapter;
      const fields = [{ name: "alpha", type: "text" }];

      const collection = await seedBuilderCollection(adapter, {
        slug: "registeredposts",
        fields,
      });
      const single = await seedBuilderSingle(adapter, {
        slug: "registeredsettings",
        fields,
      });
      const group = await seedBuilderComponent(adapter, {
        slug: "registeredhero",
        fields,
      });

      for (const { tableName } of [collection, single, group]) {
        // A select is the narrowest model-bound call: it resolves the table
        // object and refuses by name when the resolver has none.
        await expect(adapter.select(tableName)).resolves.toEqual([]);
      }
    } finally {
      await handle.destroy();
    }
  });
});
