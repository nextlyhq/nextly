/**
 * A plugin's relational query is held to its reach at every table it
 * traverses, on a real database.
 *
 * The plugin declares a foreign key from its notes to core's `users`, a
 * table its access does not cover, and one to its own authors. Each key
 * carries a relation edge, so `with` can name either. Following the one to
 * `users`, at the root or nested under an edge the plugin may follow, is
 * refused before any SQL runs; following its own, at the same depths,
 * returns the nested rows. The unit tests judge the walk against a relations
 * config built by hand; this boots the plugin, so the edges are the ones the
 * compiler derives from the keys and the registry composes.
 */
import { afterEach, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { col, defineTable } from "../../../domains/schema/extension/dsl";
import { describeEachDialect } from "../../__tests__/helpers/dialect-matrix";
import { definePlugin, type PluginContext } from "../../plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../test-nextly";

const authors = defineTable(
  "authors",
  { id: col.id(), name: col.shortText() },
  {
    relations: [
      {
        name: "notes",
        kind: "many",
        targetTable: "rqr__notes",
        toColumn: "author_id",
      },
    ],
  }
);
const notes = defineTable(
  "notes",
  {
    id: col.id(),
    title: col.shortText(),
    authorId: col.shortText(),
    userId: col.shortText({ nullable: true }),
  },
  {
    foreignKeys: [
      {
        columns: ["authorId"],
        references: { table: "rqr__authors", columns: ["id"] },
      },
      // Core's table, which the plugin's access does not reach.
      { columns: ["userId"], references: { table: "users", columns: ["id"] } },
    ],
  }
);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Boot the plugin with one author and one note, and hand back its context. */
async function boot(dialect: TestDialect): Promise<PluginContext> {
  let captured: PluginContext | undefined;
  current = await createTestNextly({
    dialect,
    plugins: [
      definePlugin({
        name: "@test/relational-reach",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { schema: { prefix: "rqr", tables: [authors, notes] } },
        init(ctx) {
          captured = ctx;
        },
      }),
    ],
  });
  if (captured === undefined) throw new Error("the plugin did not initialise");
  const author = await captured.db.insertReturning(authors, { name: "Ada" });
  await captured.db.insertReturning(notes, {
    title: "first",
    authorId: author.id,
  });
  return captured;
}

/** The refusal's reason, when `run` was refused for reach; else what it did. */
async function reachRefusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    if (NextlyError.isForbidden(error)) {
      return (error.logContext as { reason?: unknown } | undefined)?.reason;
    }
    throw error;
  }
  return "not refused";
}

describeEachDialect(
  "a plugin's relational query through its own foreign keys",
  dialect => {
    it("is refused through its key to a table outside its reach, at the root and nested", async () => {
      const ctx = await boot(dialect);
      expect(
        await reachRefusal(() =>
          ctx.db.query.rqr__notes.findMany({ with: { user: true } })
        )
      ).toBe("table-not-declared");
      expect(
        await reachRefusal(() =>
          ctx.db.query.rqr__authors.findMany({
            with: { notes: { with: { user: true } } },
          })
        )
      ).toBe("table-not-declared");
    });

    it("control: returns the nested rows through its key to its own table", async () => {
      const ctx = await boot(dialect);
      const rows = await ctx.db.query.rqr__notes.findMany({
        with: { author: true },
      });
      expect(rows).toEqual([
        expect.objectContaining({
          title: "first",
          author: expect.objectContaining({ name: "Ada" }),
        }),
      ]);
      const nested = await ctx.db.query.rqr__authors.findMany({
        with: { notes: { with: { author: true } } },
      });
      expect(nested).toEqual([
        expect.objectContaining({
          name: "Ada",
          notes: [
            expect.objectContaining({
              title: "first",
              author: expect.objectContaining({ name: "Ada" }),
            }),
          ],
        }),
      ]);
    });
  }
);
