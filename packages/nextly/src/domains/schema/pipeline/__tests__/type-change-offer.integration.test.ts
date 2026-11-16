/**
 * The type change `db:sync` and the development push offer, judged by the repair command's rule on
 * the rows the live column holds, through the real classifier, terminal dispatcher and pre-cleanup,
 * with no terminal to ask (a CI run).
 *
 * - A safe conversion goes ahead without a question.
 * - A lossy one (a group held as text, with an empty string) is refused before any statement,
 *   naming its row and the consent naming its column; under that consent the named row is cleared
 *   and the column converted; a consent without a list does not cover it.
 * - A blocked one (a MySQL text column holding a value longer than the varchar it is to become) is
 *   refused before any statement, naming its row and what the owner can change.
 * - On SQLite, where JSON is text, a group column has no conversion to plan; an integer column
 *   becoming a real is lossy where a row holds a word.
 *
 * Every refused case asserts the table's definition and values are as they were.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { consoleLogger } from "../../../../shared/types";
import {
  asJson,
  f,
  tableTools,
} from "../../repair-columns/__tests__/apply-fixture";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { RealClassifier } from "../classifier/classifier";
import { RealPreCleanupExecutor } from "../pre-cleanup/executor";
import { previewDesiredSchema } from "../preview";
import { ClackTerminalPromptDispatcher } from "../prompt-dispatcher/clack-terminal";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../rename-detector";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";

const TABLE = "dc_tco_posts";
const TITLE = f({ name: "title", type: "text" });
const SEO = f({
  name: "seo",
  type: "group",
  fields: [{ name: "title", type: "text" }],
});
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});
const WHOLE_PRICE = f({ name: "price", type: "number" });
const CONSENT = "NEXTLY_ACCEPT_DATA_LOSS";

describe.each(getConfiguredTestDialects())(
  "the type change db:sync offers on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;
    const db = () => handle.adapter.getDrizzle();
    const printed: string[] = [];
    /** MySQL's apply names its database, as `db:sync` reads it from the connection URL. */
    let databaseName: string | undefined;

    /** One code-first apply of the collection with `fields`, as `db:sync` makes it. */
    const sync = (fields: FieldDefinition[]) =>
      new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db()),
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
            posts: { slug: "posts", tableName: TABLE, fields: fields as never },
          },
          singles: {},
          components: {},
        },
        db: db(),
        dialect,
        source: "code",
        promptChannel: "terminal",
        nextStep: "run db:sync again",
        ...(databaseName !== undefined ? { databaseName } : {}),
      });

    /** The table's definition and every value of `column`, to compare across a refusal. */
    const state = async (column: string) => ({
      definition: await tools.definition(TABLE),
      values: await tools.values(TABLE, column),
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
      delete process.env[CONSENT];
    });

    afterEach(async () => {
      delete process.env[CONSENT];
      vi.restoreAllMocks();
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await handle?.destroy();
    });

    /** A group held as text, as an older generator left it, with `rows` as its values. */
    async function groupAsText(rows: Record<string, string | null>) {
      await tools.createTable(TABLE, [TITLE, SEO]);
      await tools.retype(TABLE, "seo", "text");
      await tools.insert(
        TABLE,
        Object.entries(rows).map(([id, seo]) => ({ id, title: "t", seo }))
      );
    }

    describe.skipIf(dialect === "sqlite")("a group held as text", () => {
      it("the offer for each known shape: a group whose values all parse converts without asking", async () => {
        const info = vi.spyOn(consoleLogger, "info");
        await groupAsText({ p0: '{"title":"a"}', p1: null });

        const result = await sync([TITLE, SEO]);

        expect(result.success).toBe(true);
        expect((await tools.columnState(TABLE, "seo"))?.type).toBe(
          dialect === "postgresql" ? "jsonb" : "json"
        );
        expect(asJson((await tools.values(TABLE, "seo")).p0)).toEqual({
          title: "a",
        });
        expect(info.mock.calls.flat().join("\n")).toMatch(
          new RegExp(
            `${TABLE}\\.seo: text -> json[b]?, safe \\(rows checked: 2\\)`
          )
        );
      });

      it("an empty string in a group column is refused before any statement, naming the row", async () => {
        await groupAsText({ p0: '{"title":"a"}', p1: "", p2: null });
        const before = await state("seo");

        const result = await sync([TITLE, SEO]);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          `${TABLE}.seo: text -> ${dialect === "postgresql" ? "jsonb" : "json"} is lossy: values that do not parse as JSON would be cleared (1 row: id p1).`
        );
        expect(result.error?.message).toContain(
          `--accept-data-loss=${TABLE}.seo`
        );
        // No raw database error, and nothing ran.
        expect(result.error?.message).not.toMatch(
          /22P02|invalid input syntax|Invalid JSON text/i
        );
        expect(await state("seo")).toEqual(before);
      });

      it("a consent without a list does not cover clearing the named values", async () => {
        await groupAsText({ p0: '{"title":"a"}', p1: "" });
        const before = await state("seo");
        process.env[CONSENT] = "1";

        const result = await sync([TITLE, SEO]);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain(
          "without a list does not cover a type change"
        );
        expect(await state("seo")).toEqual(before);
      });

      it("under the consent naming the column, clears exactly the named row and converts", async () => {
        await groupAsText({ p0: '{"title":"a"}', p1: "", p2: "not json" });
        process.env[CONSENT] = `${TABLE}.seo`;

        const result = await sync([TITLE, SEO]);

        expect(result.success).toBe(true);
        const values = await tools.values(TABLE, "seo");
        expect(asJson(values.p0)).toEqual({ title: "a" });
        expect(values.p1).toBeNull();
        expect(values.p2).toBeNull();
        expect(printed.join("\n")).toContain(
          "Clearing the value in 2 rows, under the consent naming the column."
        );
      });
    });

    describe.skipIf(dialect === "sqlite")("a float held as a decimal", () => {
      it("the offer for each known shape: a decimal(10,2) float converts to a double without asking", async () => {
        await tools.createTable(TABLE, [TITLE, PRICE]);
        await tools.retype(TABLE, "price", "decimal(10,2)");
        await tools.insert(TABLE, [
          { id: "p0", title: "t", price: 12.5 },
          { id: "p1", title: "t", price: null },
        ]);

        const result = await sync([TITLE, PRICE]);

        expect(result.success).toBe(true);
        expect(Number((await tools.values(TABLE, "price")).p0)).toBe(12.5);
      });
    });

    describe.skipIf(dialect !== "mysql")(
      "a MySQL text the legacy map left",
      () => {
        it("the offer for each known shape: a value longer than the varchar is refused before any statement", async () => {
          await tools.createTable(TABLE, [TITLE]);
          await tools.retype(TABLE, "title", "text");
          await tools.insert(TABLE, [
            { id: "p0", title: "short" },
            { id: "p2", title: "x".repeat(300) },
          ]);
          const before = await state("title");

          const result = await sync([TITLE]);

          expect(result.success).toBe(false);
          expect(result.error?.message).toContain(
            `${TABLE}.title: text -> varchar(255) is blocked: values longer than the new type holds would be cut (1 row: id p2).`
          );
          expect(result.error?.message).toContain(
            "shorten the named values so each fits the new type, then run db:sync again"
          );
          expect(await state("title")).toEqual(before);
        });
      }
    );

    describe.skipIf(dialect !== "sqlite")("SQLite", () => {
      it("no conversion is planned for a group column, which SQLite holds as text", async () => {
        await tools.createTable(TABLE, [TITLE, SEO]);
        await tools.insert(TABLE, [{ id: "p1", title: "t", seo: "" }]);

        const preview = await previewDesiredSchema({
          desired: {
            collections: {
              posts: {
                slug: "posts",
                tableName: TABLE,
                fields: [TITLE, SEO] as never,
              },
            },
            singles: {},
            components: {},
          },
          db: db(),
          dialect,
          nextStep: "run db:sync again",
        });

        expect(
          preview.operations.filter(
            op => op.type === "change_column_type" && op.columnName === "seo"
          )
        ).toEqual([]);
        const result = await sync([TITLE, SEO]);
        expect(result.success).toBe(true);
        expect((await tools.values(TABLE, "seo")).p1).toBe("");
      });

      it("the offer for each known shape: an integer becoming a real is lossy where a row holds a word", async () => {
        await tools.createTable(TABLE, [TITLE, WHOLE_PRICE]);
        await tools.insert(TABLE, [
          { id: "p0", title: "t", price: 3 },
          { id: "p1", title: "t", price: "word" },
        ]);
        const before = await state("price");

        const refused = await sync([TITLE, PRICE]);
        expect(refused.success).toBe(false);
        expect(refused.error?.message).toContain(
          `${TABLE}.price: integer -> real is lossy: values the new type would keep in a form the field cannot read would be cleared (1 row: id p1).`
        );
        expect(await state("price")).toEqual(before);

        process.env[CONSENT] = `${TABLE}.price`;
        clearCachedSnapshot();
        const converted = await sync([TITLE, PRICE]);
        expect(converted.success).toBe(true);
        const values = await tools.values(TABLE, "price");
        expect(Number(values.p0)).toBe(3);
        expect(values.p1).toBeNull();
      });
    });
  }
);
