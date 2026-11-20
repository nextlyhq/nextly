/**
 * A unit's `before` (`BusyTableRun.before`), on SQLite, PostgreSQL and MySQL: run on every try,
 * before the unit's first statement, inside the unit's transaction, on the handle its statements
 * run on. What it reads or writes there is what the statements then see, and it is undone with
 * them.
 *
 * What separates the right placement from plausible wrong ones:
 * - a `before` run after the statements, or not at all, leaves the row the unit's `UPDATE` would
 *   have counted at its start value;
 * - one run outside the unit's transaction keeps its row when a later statement fails;
 * - one run once per unit, not per try, is counted once when the first try waits for a held row;
 * - one run again on a MySQL try resumed past a schema statement that committed is counted twice.
 */
import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { runUnitInTries } from "../run-unit";

const TABLE = `rub_${randomBytes(4).toString("hex")}_marks`;
// A table of its own for a schema statement that commits, since one on `TABLE` would wait for the
// row another session holds there (MySQL's metadata lock) and commit nothing.
const SIDE = `${TABLE}_side`;

let instance: TestNextly | undefined;
afterEach(async () => {
  await instance?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
  await instance?.adapter.executeQuery(`DROP TABLE IF EXISTS ${SIDE}`);
  await instance?.destroy();
  instance = undefined;
});

/** One statement run on `db`, the handle a unit's statements run on, as each dialect takes it. */
async function runOn(
  db: unknown,
  dialect: TestDialect,
  statement: string
): Promise<void> {
  if (dialect === "sqlite") {
    (db as { run(query: ReturnType<typeof sql.raw>): unknown }).run(
      sql.raw(statement)
    );
    return;
  }
  await (
    db as { execute(query: ReturnType<typeof sql.raw>): Promise<unknown> }
  ).execute(sql.raw(statement));
}

describe.each(getConfiguredTestDialects())(
  "a unit's before, run in its tries (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({ dialect });
      instance = t;
      await t.adapter.executeQuery(
        `CREATE TABLE ${TABLE} (id integer PRIMARY KEY, n integer NOT NULL)`
      );
      return t;
    }

    const unit = { source: "before-hook-test", transaction: true };
    const run = (before: (db: unknown) => Promise<void>) => ({
      bounds: { tryMs: 1_000, totalMs: 10_000 },
      notify: () => undefined,
      appliedBefore: () => [],
      before,
    });

    async function valueOf(t: TestNextly): Promise<number | undefined> {
      const [row] = await t.adapter.executeQuery<{ n: number | string }>(
        `SELECT n FROM ${TABLE} WHERE id = 1`
      );
      return row === undefined ? undefined : Number(row.n);
    }

    it("runs it before the unit's first statement, on the handle the statements run on", async () => {
      const t = await boot();

      await runUnitInTries(
        t.adapter,
        [`UPDATE ${TABLE} SET n = n + 1 WHERE id = 1`],
        unit,
        async () => undefined,
        run(db =>
          runOn(db, dialect, `INSERT INTO ${TABLE} (id, n) VALUES (1, 0)`)
        )
      );

      // The row `before` wrote was there for the unit's UPDATE.
      expect(await valueOf(t)).toBe(1);
    });

    it("undoes what it wrote with the unit's transaction when a later statement fails", async () => {
      const t = await boot();

      // The unit's own insert repeats the key `before` wrote, so it fails, and the transaction
      // takes `before`'s row back with it.
      await expect(
        runUnitInTries(
          t.adapter,
          [`INSERT INTO ${TABLE} (id, n) VALUES (1, 5)`],
          unit,
          async () => undefined,
          run(db =>
            runOn(db, dialect, `INSERT INTO ${TABLE} (id, n) VALUES (1, 0)`)
          )
        )
      ).rejects.toBeDefined();

      expect(await valueOf(t)).toBeUndefined();
    });

    // SQLite's suite runs in memory, where no second connection can hold a row.
    it.skipIf(dialect === "sqlite")(
      "runs it again on each try after a try ends waiting for a held row",
      async () => {
        const t = await boot();
        await t.adapter.executeQuery(
          `INSERT INTO ${TABLE} (id, n) VALUES (1, 0)`
        );
        // Another session holds the row until released, so the first try's UPDATE waits past
        // its one-second bound and the unit is tried again.
        let release: () => void = () => undefined;
        const released = new Promise<void>(resolve => {
          release = resolve;
        });
        let held: () => void = () => undefined;
        const isHeld = new Promise<void>(resolve => {
          held = resolve;
        });
        const holding = t.adapter.transaction(async tx => {
          await tx.execute(`SELECT n FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
          held();
          await released;
        });
        await isHeld;
        const freed = new Promise(resolve => setTimeout(resolve, 1_500)).then(
          () => release()
        );

        let calls = 0;
        await runUnitInTries(
          t.adapter,
          [`UPDATE ${TABLE} SET n = n + 1 WHERE id = 1`],
          unit,
          async () => undefined,
          run(async () => {
            calls += 1;
          })
        );
        await freed;
        await holding;

        expect(calls).toBeGreaterThanOrEqual(2);
        expect(await valueOf(t)).toBe(1);
      },
      30_000
    );

    // MySQL commits a schema statement as it runs, so a try that ends after one resumes past it:
    // what `before` read is already changed by it, and a refusal then would undo none of it.
    it.runIf(dialect === "mysql")(
      "does not run it again on a try resumed after a statement that committed on its own",
      async () => {
        const t = await boot();
        await t.adapter.executeQuery(
          `INSERT INTO ${TABLE} (id, n) VALUES (1, 0)`
        );
        let release: () => void = () => undefined;
        const released = new Promise<void>(resolve => {
          release = resolve;
        });
        let held: () => void = () => undefined;
        const isHeld = new Promise<void>(resolve => {
          held = resolve;
        });
        const holding = t.adapter.transaction(async tx => {
          await tx.execute(`SELECT n FROM ${TABLE} WHERE id = 1 FOR UPDATE`);
          held();
          await released;
        });
        await isHeld;
        const freed = new Promise(resolve => setTimeout(resolve, 1_500)).then(
          () => release()
        );

        let calls = 0;
        await runUnitInTries(
          t.adapter,
          [
            `CREATE TABLE ${SIDE} (id integer PRIMARY KEY)`,
            `UPDATE ${TABLE} SET n = n + 1 WHERE id = 1`,
          ],
          unit,
          async () => undefined,
          run(async () => {
            calls += 1;
          })
        );
        await freed;
        await holding;

        // Run once, before the CREATE; the try resumed at the UPDATE did not run it again.
        expect(calls).toBe(1);
        expect(await valueOf(t)).toBe(1);
      },
      30_000
    );
  }
);
