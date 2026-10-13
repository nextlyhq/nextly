/**
 * Schema hooks run in dependency order whatever order the config lists the
 * plugins in.
 *
 * The compiler runs plugins in the order it is handed, and the unit tests of
 * ordering hand it a sorted list; the resolver's sort is tested on its own.
 * Only a boot joins the two, so this one lists a dependent plugin BEFORE the
 * plugin it depends on: its hook extends the dependency's table, which exists
 * only if the dependency's contribution ran first.
 */
import { afterEach, expect, it } from "vitest";

import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { getActiveExtensionSchema } from "../build-extension-schema";
import { col, defineTable } from "../dsl";

const orders = defineTable("orders", { id: col.id() });

const dependency = definePlugin({
  name: "@test/order-base",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: { schema: { prefix: "ob", tables: [orders] } },
});

const dependent = definePlugin({
  name: "@test/order-notes",
  version: "1.0.0",
  nextly: ">=0.0.0",
  dependsOn: { "@test/order-base": ">=1.0.0" },
  contributes: {
    schema: {
      prefix: "on",
      extend: [
        ({ schema }) => {
          schema.extendTable("ob__orders", {
            columns: { noteRef: col.shortText({ nullable: true }) },
          });
        },
      ],
    },
  },
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect("schema hooks at boot", dialect => {
  it("run a dependency's contribution before its dependent's, listed the other way round", async () => {
    current = await createTestNextly({
      dialect,
      // The dependent first: the order the config gives, not the one hooks run in.
      plugins: [dependent, dependency],
    });

    const orderTable = getActiveExtensionSchema(dialect)?.tables.find(
      table => table.name === "ob__orders"
    );
    expect(orderTable?.columns.map(column => column.name)).toContain(
      "note_ref"
    );
  });
});
