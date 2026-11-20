/**
 * A column in a unique index of several columns, changed to a type that reads two of its values as
 * one: "1" and " 1" are two texts and one number, so two rows that differ only there become one
 * pair to an index of that column and another.
 *
 * Through the real classifier, terminal dispatcher and pre-cleanup, as `db:sync` runs with no
 * terminal to ask. Whatever refuses the change, the table's definition and values are as they
 * were: on SQLite the judgement, before any statement, since its rebuild would have landed by the
 * time the index failed; on PostgreSQL and MySQL the database, whose statement changes nothing
 * when it fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { f, tableTools } from "../../repair-columns/__tests__/apply-fixture";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { RealClassifier } from "../classifier/classifier";
import { RealPreCleanupExecutor } from "../pre-cleanup/executor";
import { ClackTerminalPromptDispatcher } from "../prompt-dispatcher/clack-terminal";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../rename-detector";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";

const TABLE = "dc_tcu_posts";
const TITLE = f({ name: "title", type: "text" });
const CODE = f({ name: "code", type: "text" });
const CODE_NUMBER = f({ name: "code", type: "number" });
const INDEXES = [{ fields: ["code", "title"], unique: true }];

describe.each(getConfiguredTestDialects())(
  "a type change under a unique index of several columns on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;
    const printed: string[] = [];
    /** MySQL's apply names its database, as `db:sync` reads it from the connection URL. */
    let databaseName: string | undefined;

    /**
     * One code-first apply of the collection with `fields`, as `db:sync` makes it, `recorded`
     * being its fields as the registry held them before.
     */
    const sync = (
      fields: FieldDefinition[],
      recorded?: FieldDefinition[],
      indexes: { fields: string[]; unique: boolean }[] = INDEXES
    ) =>
      new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(
          dialect,
          handle.adapter.getDrizzle()
        ),
        renameDetector: new RegexRenameDetector(),
        classifier: new RealClassifier(),
        promptDispatcher: new ClackTerminalPromptDispatcher(line =>
          printed.push(line)
        ),
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: noopMigrationJournal,
        notifier: noopNotifier,
      }).apply({
        desired: {
          collections: {
            posts: {
              slug: "posts",
              tableName: TABLE,
              fields: fields as never,
              indexes,
              ...(recorded !== undefined
                ? { recordedFields: recorded as never }
                : {}),
            },
          },
          singles: {},
          components: {},
        },
        db: handle.adapter.getDrizzle(),
        dialect,
        source: "code",
        promptChannel: "terminal",
        nextStep: "run db:sync again",
        ...(databaseName !== undefined ? { databaseName } : {}),
      });

    const state = async () => ({
      definition: await tools.definition(TABLE),
      values: await tools.values(TABLE, "code"),
    });

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      databaseName =
        dialect === "mysql"
          ? String(
              (
                (await run("SELECT DATABASE() AS db")) as Array<{ db: unknown }>
              )[0]?.db
            )
          : undefined;
      clearCachedSnapshot();
      printed.length = 0;
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await handle?.destroy();
    });

    it("refuses values the index would hold twice as the new type, and changes nothing", async () => {
      await tools.createTable(TABLE, [TITLE, CODE]);
      // The index, made as the pipeline makes it for this database.
      const indexed = await sync([TITLE, CODE]);
      expect(indexed.error).toBeUndefined();
      clearCachedSnapshot();
      await tools.insert(TABLE, [
        { id: "p1", title: "t", code: "1" },
        { id: "p2", title: "t", code: " 1" },
        { id: "p3", title: "u", code: "1" },
      ]);
      const before = await state();

      const result = await sync([TITLE, CODE_NUMBER], [TITLE, CODE]);

      expect(result.success).toBe(false);
      expect(await state()).toEqual(before);
      if (dialect === "sqlite") {
        // Refused by the judgement, which names the two rows: no statement was tried.
        expect(result.error?.message).toMatch(/p1.*p2/s);
      }
    });

    it("refuses values two changed columns of the index would hold twice together, and changes nothing", async () => {
      // Each column alone holds no repeat: "1" and " 1" differ under " 2" and "2". Both become
      // numbers in the one rebuild, and both rows become (1, 2).
      await tools.createTable(TABLE, [TITLE, CODE]);
      const indexed = await sync([TITLE, CODE]);
      expect(indexed.error).toBeUndefined();
      clearCachedSnapshot();
      await tools.insert(TABLE, [
        { id: "p1", title: " 2", code: "1" },
        { id: "p2", title: "2", code: " 1" },
      ]);
      const before = await state();

      const result = await sync(
        [f({ name: "title", type: "number" }), CODE_NUMBER],
        [TITLE, CODE]
      );

      expect(result.success).toBe(false);
      expect(await state()).toEqual(before);
    });

    // Only SQLite reads the index's other columns before the apply: the per-value judgement is
    // asked there alone.
    it.skipIf(dialect !== "sqlite")(
      "judges a change whose index names a column the same push adds",
      async () => {
        // The index's new column holds nothing yet, so it repeats nothing: no row is read from it.
        await tools.createTable(TABLE, [TITLE, CODE]);
        clearCachedSnapshot();
        await tools.insert(TABLE, [
          { id: "p1", title: "t", code: "1" },
          { id: "p2", title: "t", code: "2" },
        ]);

        const result = await sync(
          [TITLE, CODE_NUMBER, f({ name: "sku", type: "text" })],
          [TITLE, CODE],
          [{ fields: ["code", "sku"], unique: true }]
        );

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
      }
    );
  }
);
