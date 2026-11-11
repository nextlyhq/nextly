/**
 * An enum's lifecycle on a real database, on every dialect: a value added
 * applies, and a value taken away while a row holds it is refused by the
 * APPLY — naming the value, the column and the rows — rather than left to the
 * database's own refusal after the old check's drop has run.
 *
 * The refusal is the pipeline's pre-flight gate
 * (`enum-narrowing-refusal.ts`), so the discriminating assertion is the
 * ERROR's shape: without the gate the same apply still fails, but as a DDL
 * execution error quoting none of what a usable refusal names.
 */
import { afterEach, describe, expect, it } from "vitest";

import { definePlugin } from "../../../../plugins/plugin-context";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";

import { applyDesiredSchema } from "../../pipeline/index";
import { col, defineTable } from "../dsl";
import { compileAndPublishExtensionSchema } from "../publish";

const stagesV1 = defineTable("stages", {
  id: col.id(),
  state: col.enum(["draft", "live"]),
});

const release = (values: readonly [string, ...string[]]) =>
  definePlugin({
    name: "schema-e2e-enum-narrowing",
    version: "0.0.0",
    nextly: "*",
    contributes: {
      schema: {
        prefix: "en",
        tables: [
          defineTable("stages", { id: col.id(), state: col.enum(values) }),
        ],
      },
    },
  });

const apply = () =>
  applyDesiredSchema({ collections: {}, singles: {}, components: {} }, "code", {
    promptChannel: "terminal",
  });

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect(
  "an enum's values changed on an existing database",
  dialect => {
    it("adds a value, and refuses to take one away while a row holds it", async () => {
      current = await createTestNextly({
        dialect,
        plugins: [release(["draft", "live"])],
      });
      const adapter = current.adapter;
      const insert = (id: string, state: string) =>
        adapter.executeQuery(
          `INSERT INTO en__stages (id, state) VALUES ('${id}', '${state}')`
        );
      await insert("held", "live");
      await insert("kept", "draft");

      // ADD a value: an ordinary check change, applied by the next apply.
      await compileAndPublishExtensionSchema({
        dialect,
        plugins: [release(["draft", "live", "archived"])],
        config: {},
        logger: { warn: () => {} },
      });
      const widened = await apply();
      expect(widened.success, JSON.stringify(widened)).toBe(true);

      // TAKE ONE AWAY while a row holds it: refused before anything runs,
      // naming the value, the column and the row — not the database's
      // "violated by some row", which names none of them.
      await compileAndPublishExtensionSchema({
        dialect,
        plugins: [release(["draft", "archived"])],
        config: {},
        logger: { warn: () => {} },
      });
      const refused = await apply();
      expect(refused.success).toBe(false);
      if (refused.success) return;
      expect(refused.error.code).toBe("PRECONDITION_FAILED");
      const said = JSON.stringify(refused.error);
      expect(said).toContain("'live'");
      expect(said).toContain("en__stages");
      expect(said).toContain("state");
      expect(said).toContain("1 row holds");

      // The refusal was about the rows, not the change: with the row gone
      // the same narrowing applies, and the value it took away is refused by
      // the check that landed.
      await adapter.executeQuery(`DELETE FROM en__stages WHERE id = 'held'`);
      const narrowed = await apply();
      expect(narrowed.success, JSON.stringify(narrowed)).toBe(true);
      await expect(insert("late", "live")).rejects.toThrow();
      await insert("after", "archived");
    });
  }
);
