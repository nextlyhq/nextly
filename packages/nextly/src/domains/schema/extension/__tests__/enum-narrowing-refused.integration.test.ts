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
import { createConnection } from "mysql2/promise";
import { afterEach, expect, it } from "vitest";

import { definePlugin } from "../../../../plugins/plugin-context";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";

import { applyDesiredSchema } from "../../pipeline/index";
import { currentMysqlDatabaseName } from "../../pipeline/database-url";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreCleanupExecutor,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../../pipeline/pushschema-pipeline-stubs";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { col, defineTable } from "../dsl";
import { compileAndPublishExtensionSchema } from "../publish";

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

      // The old check is still in place: the refusal happened before any
      // statement ran, so a value outside the widened check is still rejected.
      await expect(insert("bogus", "invalid")).rejects.toThrow();

      // The refusal was about the rows, not the change: with the row gone
      // the same narrowing applies, and the value it took away is refused by
      // the check that landed.
      await adapter.executeQuery(`DELETE FROM en__stages WHERE id = 'held'`);
      const narrowed = await apply();
      expect(narrowed.success, JSON.stringify(narrowed)).toBe(true);
      await expect(insert("late", "live")).rejects.toThrow();
      await insert("after", "archived");
    });

    it("refuses taking away a value holding a backslash, which MySQL reports escaped", async () => {
      // MySQL hands the live check back with the backslash escaped in a form
      // whose meaning depends on its sql_mode, so the old check cannot be read
      // back: the pair is found by its name and the rows name the value.
      const slashed = "back\\slash";
      current = await createTestNextly({
        dialect,
        plugins: [release(["draft", slashed])],
      });
      const adapter = current.adapter;
      await adapter.executeQuery(
        `INSERT INTO en__stages (id, state) VALUES ('held', ${dialect === "postgresql" ? "$1" : "?"})`,
        [slashed]
      );

      await compileAndPublishExtensionSchema({
        dialect,
        plugins: [release(["draft"])],
        config: {},
        logger: { warn: () => {} },
      });
      const refused = await apply();
      expect(refused.success).toBe(false);
      if (refused.success) return;
      expect(refused.error.code).toBe("PRECONDITION_FAILED");
      const said = JSON.stringify(refused.error);
      expect(said).toContain("1 row holds");
      expect(said).toContain("back");

      // Nothing ran: the value is still there and the old check still refuses
      // a value outside it.
      await expect(
        adapter.executeQuery(
          `INSERT INTO en__stages (id, state) VALUES ('bogus', 'invalid')`
        )
      ).rejects.toThrow();
    });

    it("does not count retained values or collation-equivalent spellings as removed", async () => {
      current = await createTestNextly({
        dialect,
        plugins: [release(["draft", "live", "Live"])],
      });
      const adapter = current.adapter;
      await adapter.executeQuery(
        `INSERT INTO en__stages (id, state) VALUES ('kept-case', 'Live')`
      );

      // Dropping 'live' while keeping 'Live' leaves 'Live' allowed on every
      // dialect, including case-insensitive MySQL collations where 'live' and
      // 'Live' compare equal.
      await compileAndPublishExtensionSchema({
        dialect,
        plugins: [release(["draft", "Live"])],
        config: {},
        logger: { warn: () => {} },
      });
      const kept = await apply();
      expect(kept.success, JSON.stringify(kept)).toBe(true);

      if (dialect === "mysql") {
        // Under MySQL's default case-insensitive collation, changing 'Live' to
        // 'live' still accepts the existing 'Live' row.
        await compileAndPublishExtensionSchema({
          dialect,
          plugins: [release(["draft", "live"])],
          config: {},
          logger: { warn: () => {} },
        });
        const respelled = await apply();
        expect(respelled.success, JSON.stringify(respelled)).toBe(true);
      } else {
        // On case-sensitive dialects, changing 'Live' to 'live' takes 'Live'
        // away and refuses while a row still holds 'Live'.
        await compileAndPublishExtensionSchema({
          dialect,
          plugins: [release(["draft", "live"])],
          config: {},
          logger: { warn: () => {} },
        });
        const refused = await apply();
        expect(refused.success).toBe(false);
        if (!refused.success) {
          expect(refused.error.code).toBe("PRECONDITION_FAILED");
        }
      }
    });

    if (dialect === "mysql") {
      it("keeps the old check intact when a concurrent writer inserts a removed value before MySQL DDL runs", async () => {
        current = await createTestNextly({
          dialect,
          plugins: [release(["draft", "live"])],
        });
        const adapter = current.adapter;
        const db = adapter.getDrizzle();
        const insert = (id: string, state: string) =>
          adapter.executeQuery(
            `INSERT INTO en__stages (id, state) VALUES ('${id}', '${state}')`
          );

        await compileAndPublishExtensionSchema({
          dialect,
          plugins: [release(["draft"])],
          config: {},
          logger: { warn: () => {} },
        });

        const databaseName = await currentMysqlDatabaseName(db);
        const writerUrl = new URL(process.env.TEST_MYSQL_URL ?? "");
        writerUrl.pathname = `/${databaseName}`;

        const pipeline = new PushSchemaPipeline(
          {
            executor: new DrizzleStatementExecutor(dialect, db),
            renameDetector: noopRenameDetector,
            classifier: noopClassifier,
            promptDispatcher: noopPromptDispatcher,
            preRenameExecutor: noopPreRenameExecutor,
            preCleanupExecutor: noopPreCleanupExecutor,
            migrationJournal: noopMigrationJournal,
            notifier: noopNotifier,
          },
          {
            // Simulates a concurrent writer connection inserting a removed
            // value after preflight passes and before Phase D replaces the check.
            _kitOverride: {
              pushSchema: async () => {
                const writer = await createConnection(writerUrl.toString());
                try {
                  await writer.query(
                    `INSERT INTO en__stages (id, state) VALUES ('raced', 'live')`
                  );
                } finally {
                  await writer.end();
                }
                return { sqlStatements: [], hints: [] };
              },
            },
          }
        );

        const result = await pipeline.apply({
          desired: { collections: {}, singles: {}, components: {} },
          db,
          dialect,
          source: "code",
          promptChannel: "terminal",
          databaseName,
        });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("DDL_EXECUTION_FAILED");

        // Atomic replacement kept the old check in place rather than dropping it
        // first and leaving the column unconstrained.
        await expect(insert("bogus", "invalid")).rejects.toThrow();
      });
    }
  }
);
