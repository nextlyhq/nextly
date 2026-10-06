/**
 * `ctx.db.contributed` end to end: a real boot, a real `dc_posts`, and each
 * plugin's own `ctx.db`.
 *
 * The unit suite judges the access rule against a hand-built contributions
 * map. This one proves the map the running system builds — from the compiled
 * schema's record of who contributed each column — grants the contributor its
 * own column and nothing else, through the context a plugin actually receives.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { NextlyError } from "../../../errors/nextly-error";
import type { PluginContext } from "../../plugin-context";
import { definePlugin } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";
import { describeEachDialect } from "../../__tests__/helpers/dialect-matrix";

const searchColumns = { searchVector: col.text({ nullable: true }) };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function refusal(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describeEachDialect("ctx.db.contributed", dialect => {
  it("gives the contributor its column on dc_posts, and no one else", async () => {
    const contexts = new Map<string, PluginContext>();
    const contributor = definePlugin({
      name: "@test/search-index",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        schema: {
          extend: [
            ({ schema }) => {
              schema.extendTable("dc_posts", { columns: searchColumns });
            },
          ],
        },
      },
      init(ctx) {
        contexts.set("contributor", ctx);
      },
    });
    const bystander = definePlugin({
      name: "@test/bystander",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init(ctx) {
        contexts.set("bystander", ctx);
      },
    });

    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({
          slug: "posts",
          fields: [text({ name: "title" })],
        }),
      ],
      plugins: [contributor, bystander],
    });

    const created = await current.nextly.create({
      collection: "posts",
      data: { title: "Hello" },
      overrideAccess: true,
    });
    // The create's own result, narrowed rather than cast: the row is typed
    // as a record, and an id that is not a string would make every call
    // below address no row.
    const id = created.item.id;
    if (typeof id !== "string") {
      throw new Error(`the created post has no string id: ${String(id)}`);
    }

    const mine = contexts
      .get("contributor")!
      .db.contributed("dc_posts", searchColumns);
    await expect(mine.set(id, { searchVector: "hello" })).resolves.toBe(1);
    expect(await mine.get(id)).toEqual({ id, searchVector: "hello" });

    // The collection's own column, through the same path: refused.
    const title = await refusal(() =>
      contexts
        .get("contributor")!
        .db.contributed("dc_posts", { title: col.text({ nullable: true }) })
        .get(id)
    );
    expect(NextlyError.isForbidden(title)).toBe(true);

    // Another plugin, naming the contributor's column: refused.
    const other = await refusal(() =>
      contexts
        .get("bystander")!
        .db.contributed("dc_posts", searchColumns)
        .get(id)
    );
    expect(NextlyError.isForbidden(other)).toBe(true);
  });
});

describeEachDialect("ctx.db.contributed on a core table", dialect => {
  const hintColumns = { loginHint: col.text({ nullable: true }) };

  it("names a column the app's migrations have not added yet, then reaches it once added", async () => {
    let db: PluginContext["db"] | undefined;
    const contributor = definePlugin({
      name: "@test/login-hints",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        schema: {
          extend: [
            ({ schema }) => {
              schema.extendTable("users", { columns: hintColumns });
            },
          ],
        },
      },
      init(ctx) {
        db = ctx.db;
      },
    });
    current = await createTestNextly({ dialect, plugins: [contributor] });

    const user = await current.nextly.users.create({
      email: "hint@example.com",
      password: "Password123!",
      data: { name: "Hint", isActive: true },
    });
    const id = user.item.id;
    if (typeof id !== "string") {
      throw new Error(`the created user has no string id: ${String(id)}`);
    }

    // A core table's contribution arrives with the app's migrations, not
    // with dev push. Until it has, the call names the column rather than
    // failing with the driver's error.
    const hints = db!.contributed("users", hintColumns);
    const early = await refusal(() => hints.get(id));
    if (!NextlyError.isConflict(early)) {
      throw new Error(`expected a conflict, got ${String(early)}`);
    }
    expect(early.publicMessage).toMatch(
      /"login_hint".*"users".*not in the database yet/
    );

    // The column the migration would add, added here directly.
    await current.adapter.executeQuery(
      "ALTER TABLE users ADD COLUMN login_hint TEXT"
    );
    await expect(hints.set(id, { loginHint: "passkey" })).resolves.toBe(1);
    expect(await hints.get(id)).toEqual({ id, loginHint: "passkey" });
  });
});

describeEachDialect(
  "ctx.db.contributed on a table keyed by a number",
  dialect => {
    // `fx` owns a table whose key the database assigns (`col.serial()`); a
    // plugin depending on it contributes a column there. The row is addressed
    // by that numeric key, so the key must be bound as a number: PostgreSQL
    // refuses to compare an integer column with a text parameter.
    const counters = defineTable("counters", {
      seq: col.serial(),
      label: col.shortText({ nullable: true }),
    });
    const markColumns = { mark: col.text({ nullable: true }) };

    it("reads and writes the contributed column by the numeric key", async () => {
      let owner: PluginContext["db"] | undefined;
      let contributor: PluginContext["db"] | undefined;
      const fx = definePlugin({
        name: "@test/fx",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "fx", tables: [counters] } },
        init(ctx) {
          owner = ctx.db;
        },
      });
      const marker = definePlugin({
        name: "@test/marker",
        version: "1.0.0",
        nextly: ">=0.0.0",
        dependsOn: { "@test/fx": ">=1.0.0" },
        contributes: {
          schema: {
            extend: [
              ({ schema }) => {
                schema.extendTable("fx__counters", { columns: markColumns });
              },
            ],
          },
        },
        init(ctx) {
          contributor = ctx.db;
        },
      });
      current = await createTestNextly({ dialect, plugins: [fx, marker] });

      await owner!.insert(counters, { label: "first" });
      const [row] = await owner!.select(counters).all();
      const seq = row.seq;
      expect(typeof seq).toBe("number");

      const marks = contributor!.contributed("fx__counters", markColumns);
      await expect(marks.set(seq, { mark: "seen" })).resolves.toBe(1);
      expect(await marks.get(seq)).toEqual({ id: seq, mark: "seen" });
    });
  }
);
