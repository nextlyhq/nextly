/**
 * A conversion that commits in one step is whole or not at all: wherever a run fails, the column,
 * its values and its table's definition are either fully converted or exactly as they were.
 *
 * Each failure is injected at a different point of the conversion: as its step starts, after the
 * column was judged again and before any statement; and as its record is written, which on
 * PostgreSQL and SQLite comes after the conversion's statement in the same transaction, and on MySQL
 * comes first, as its progress. The record is refused by a trigger on the production table, so the
 * statement before it really ran.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { applyRepairs } from "../apply";
import {
  COLUMN_REPAIRS_TABLE,
  getColumnRepairsDdl,
  readRepairs,
} from "../record";

import { asJson, collection, f, recordOf, tableTools } from "./apply-fixture";

const TABLE = "dc_rf_posts";

const TITLE = f({ name: "title", type: "text" });
const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const AUTHOR = f({
  name: "author",
  type: "relationship",
  relationTo: "users",
  required: true,
});

describe.each(getConfiguredTestDialects())(
  "a failed conversion on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
      await handle?.destroy();
    });

    /** The repairs table as the run makes it, with a trigger that refuses every row. */
    async function refuseRecords() {
      await run(getColumnRepairsDdl(dialect));
      const table = q(COLUMN_REPAIRS_TABLE);
      if (dialect === "postgresql") {
        await run(
          `CREATE OR REPLACE FUNCTION rf_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'record refused'; END $$ LANGUAGE plpgsql`
        );
        await run(
          `CREATE TRIGGER rf_refuse BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION rf_refuse()`
        );
      } else if (dialect === "mysql") {
        await run(
          `CREATE TRIGGER rf_refuse BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'record refused'`
        );
      } else {
        await run(
          `CREATE TRIGGER rf_refuse BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'record refused'); END`
        );
      }
    }

    // Every shape this dialect can hold: a type change (not on SQLite, which keeps JSON as text)
    // and a NOT NULL drop.
    const fields =
      dialect === "sqlite" ? [TITLE, AUTHOR] : [TITLE, LINKS, AUTHOR];
    const columns = dialect === "sqlite" ? ["author"] : ["links", "author"];

    async function legacyTable() {
      await tools.createTable(TABLE, fields);
      if (dialect !== "sqlite") await tools.retype(TABLE, "links", "text");
      await tools.insert(TABLE, [
        {
          id: "p1",
          title: "a",
          author: "u1",
          ...(dialect !== "sqlite" ? { links: '[{"url":"x"}]' } : {}),
        },
        {
          id: "p2",
          title: "b",
          author: "u2",
          ...(dialect !== "sqlite" ? { links: "[]" } : {}),
        },
      ]);
    }

    /** The table's definition and each converting column's values. */
    async function state() {
      const values: Record<string, unknown> = {};
      for (const column of columns) {
        const read = await tools.values(TABLE, column);
        values[column] = Object.fromEntries(
          Object.entries(read).map(([id, v]) => [
            id,
            column === "links" && v !== null ? asJson(v) : v,
          ])
        );
      }
      return { definition: await tools.definition(TABLE), values };
    }

    const failures = [
      {
        name: "as the step starts",
        arrange: () => Promise.resolve(),
        beforeStep: () =>
          Promise.reject(new Error("stopped as the step started")),
      },
      {
        name: "as the record is written",
        arrange: refuseRecords,
        beforeStep: () => Promise.resolve(),
      },
    ];

    it("a failure injected at each step leaves the column, its values and the table definition whole", async () => {
      for (const failure of failures) {
        await legacyTable();
        await failure.arrange();
        const before = await state();

        const document = await applyRepairs({
          adapter: handle.adapter,
          dialect,
          entities: [collection(TABLE, fields)],
          nextlyVersion: "test",
          beforeStep: failure.beforeStep,
        });

        for (const column of columns) {
          const record = recordOf(document.result?.records, column);
          expect(record.outcome, `${failure.name}: ${column}`).toBe("failed");
          expect(record.failure?.reason, `${failure.name}: ${column}`).not.toBe(
            ""
          );
        }
        // Exactly as it was, values and definition included.
        expect(await state(), failure.name).toEqual(before);
        // No progress is left behind: nothing committed, so nothing is unfinished.
        const repairs = await readRepairs(handle.adapter.getDrizzle(), dialect);
        expect(repairs, failure.name).toEqual([]);
        expect(document.exitCode, failure.name).toBe(3);

        await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
        await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
        if (dialect === "postgresql")
          await run("DROP FUNCTION IF EXISTS rf_refuse()");
      }

      // Without a failure the same columns convert whole, so the cases above failed for the
      // injected reason and not because the conversion could not run.
      await legacyTable();
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [collection(TABLE, fields)],
        nextlyVersion: "test",
      });
      for (const column of columns) {
        expect(recordOf(document.result?.records, column).outcome).toBe(
          "converted"
        );
      }
    });
  }
);
