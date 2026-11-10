/**
 * The stored reads an in-transaction handler is handed, on every dialect.
 *
 * `readStored` and `fieldPaths` let a plugin judge a value of its own field
 * type again on what the write finally stored. These pin what makes that
 * sound:
 *
 * - `fieldPaths` lists the written document's fields of the type, from its
 *   schema, at the top level and through named groups, and nothing else;
 * - `readStored` reads on the write's own transaction, so it sees the value
 *   the write has not committed yet;
 * - a type the plugin does not contribute is refused;
 * - a read the handler started and did not await is waited for, and its
 *   failure fails the write, so no read outlives the transaction.
 */
import { afterEach, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { PluginStoredValue } from "../contributions";
import { definePlugin, type PluginContext } from "../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

import { describeEachDialect } from "./helpers/dialect-matrix";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A json-backed type of the plugin's own. */
const doc = {
  type: "doc",
  storage: "json",
  component: "@test/stored-read-in-tx/admin#Doc",
} as const;

async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/stored-read-in-tx",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          fieldTypes: [doc],
          collections: [
            {
              slug: "posts",
              fields: [
                { name: "title", type: "text" },
                { name: "body", type: "doc" },
                {
                  name: "hero",
                  type: "group",
                  fields: [
                    { name: "intro", type: "doc" },
                    { name: "caption", type: "text" },
                  ],
                },
              ],
            } as unknown as CollectionConfig,
          ],
        },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

function nextly(): TestNextly["nextly"] {
  if (!current) throw new Error("not booted");
  return current.nextly;
}

/** What `run` rejected with, or a marker when it resolved. */
async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return "resolved";
}

describeEachDialect("an in-transaction handler's stored reads", dialect => {
  it("lists the document's fields of the type and reads what the write stored", async () => {
    const ctx = await boot(dialect);
    let paths: readonly string[] = [];
    let read: PluginStoredValue | undefined;
    ctx.hooks.onInTransaction("posts", async write => {
      paths = await write.fieldPaths("doc");
      read = await write.readStored("doc", {
        collection: "posts",
        id: write.id,
        field: "body",
        form: "published",
      });
    });

    await nextly().create({
      collection: "posts",
      data: { title: "One", body: { written: "uncommitted" } },
    });

    expect([...paths].sort()).toEqual(["body", "hero.intro"]);
    expect(read).toEqual({ kind: "value", value: { written: "uncommitted" } });
  });

  it("refuses a field type the plugin does not contribute", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("posts", async write => {
      await write.fieldPaths("text");
    });

    const caught = await rejectionOf(() =>
      nextly().create({ collection: "posts", data: { title: "Two" } })
    );

    expect(caught).toMatchObject({ code: "INTERNAL_ERROR" });
    expect((await nextly().count({ collection: "posts" })).total).toBe(0);
  });

  it("waits for a read the handler did not await, and fails the write with it", async () => {
    const ctx = await boot(dialect);
    ctx.hooks.onInTransaction("posts", write => {
      // Started and left: it fails once its module is loaded and the
      // collection looked up, after the handler has returned.
      void write
        .readStored("doc", {
          collection: "no-such-collection",
          id: write.id,
          field: "body",
          form: "published",
        })
        .catch(() => undefined);
    });

    const caught = await rejectionOf(() =>
      nextly().create({ collection: "posts", data: { title: "Three" } })
    );

    expect(caught).not.toBe("resolved");
    expect((await nextly().count({ collection: "posts" })).total).toBe(0);
  });
});
