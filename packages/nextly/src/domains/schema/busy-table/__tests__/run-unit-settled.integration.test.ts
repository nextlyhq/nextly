/**
 * A unit's `settled` (`BusyTableRun.settled`) on MySQL: run once for every try that ran `before`,
 * on the same handle, however the try ends: its statements all ran, one failed, or it ended waiting
 * for a row another session held. A MySQL named lock `before` takes there belongs to that
 * connection, so it is released only where `settled` runs on it before the connection goes back to
 * the pool.
 *
 * What separates the right placement from plausible wrong ones:
 * - one run only after a try whose statements all ran leaves the lock held after a failed
 *   statement, and the next try's `before` finds it taken;
 * - one run once per unit, not per try, leaves the lock of a try that ended waiting held while the
 *   next try runs;
 * - one run on another connection (the pool's) releases nothing, since `RELEASE_LOCK` of a name
 *   that connection does not hold changes nothing: the connection ids differ, and the lock stays
 *   taken.
 *
 * Each case runs for a unit in a transaction and for one outside, the runner's two paths, on MySQL;
 * every other configured dialect registers them skipped.
 */
import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { runUnitInTries } from "../run-unit";

const TABLE = `rus_${randomBytes(4).toString("hex")}_marks`;
const LOCK = `nextly:test:settled:${randomBytes(6).toString("hex")}`;

let instance: TestNextly | undefined;
afterEach(async () => {
  await instance?.adapter.executeQuery(`DROP TABLE IF EXISTS ${TABLE}`);
  await instance?.destroy();
  instance = undefined;
});

/** The first column of the first row `query` answers on `db`, a MySQL handle the runner gives. */
async function valueOn(db: unknown, query: string): Promise<unknown> {
  const result = await (
    db as { execute(query: ReturnType<typeof sql.raw>): Promise<unknown> }
  ).execute(sql.raw(query));
  const [rows] = result as [Array<Record<string, unknown>>];
  const [row] = rows;
  return row === undefined ? undefined : Object.values(row)[0];
}

/** One try's hold as `before` and `settled` saw it. */
interface TryHold {
  /** Whether the lock was free when `before` took it: a lock an earlier try kept is not. */
  freeAtTake: boolean;
  /** The connection `before` ran on. */
  takenOn: string;
  /** The connection `settled` ran on, once it ran. */
  releasedOn?: string;
}

describe.each(getConfiguredTestDialects())(
  "a unit's settled, after each of its tries (%s)",
  dialect => {
    // MySQL's named locks are what `settled` lets go; registered on every configured dialect, so
    // the file finds its cases wherever it runs, and run on MySQL only.
    const onMysql = it.runIf(dialect === "mysql");

    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({ dialect });
      instance = t;
      await t.adapter.executeQuery(
        `CREATE TABLE ${TABLE} (id integer PRIMARY KEY, n integer NOT NULL)`
      );
      await t.adapter.executeQuery(
        `INSERT INTO ${TABLE} (id, n) VALUES (1, 0)`
      );
      return t;
    }

    /** A run whose `before` takes the named lock and whose `settled` releases it, each recorded. */
    function holdingRun(tries: TryHold[]) {
      return {
        bounds: { tryMs: 1_000, totalMs: 10_000 },
        notify: () => undefined,
        appliedBefore: () => [],
        before: async (db: unknown) => {
          const free = Number(
            await valueOn(db, `SELECT IS_FREE_LOCK('${LOCK}')`)
          );
          const takenOn = String(await valueOn(db, "SELECT CONNECTION_ID()"));
          await valueOn(db, `SELECT GET_LOCK('${LOCK}', 0)`);
          tries.push({ freeAtTake: free === 1, takenOn });
        },
        settled: async (db: unknown) => {
          const held = tries.at(-1);
          if (held !== undefined) {
            held.releasedOn = String(
              await valueOn(db, "SELECT CONNECTION_ID()")
            );
          }
          await valueOn(db, `SELECT RELEASE_LOCK('${LOCK}')`);
        },
      };
    }

    /** Whether the lock is free now, asked on a pooled connection. */
    async function lockIsFree(t: TestNextly): Promise<boolean> {
      const [row] = await t.adapter.executeQuery<{ free: unknown }>(
        `SELECT IS_FREE_LOCK('${LOCK}') AS free`
      );
      return Number(row?.free) === 1;
    }

    /** Every try's lock released on the connection that took it, and nothing held now. */
    async function expectEveryTryReleased(
      t: TestNextly,
      tries: readonly TryHold[]
    ): Promise<void> {
      expect(tries.length).toBeGreaterThanOrEqual(1);
      for (const held of tries) {
        expect(held.freeAtTake).toBe(true);
        expect(held.releasedOn).toBe(held.takenOn);
      }
      expect(await lockIsFree(t)).toBe(true);
    }

    for (const transaction of [true, false]) {
      const unit = {
        source: `settled-hook-test-${transaction ? "tx" : "session"}`,
        transaction,
      };
      const path = transaction ? "in a transaction" : "outside a transaction";

      onMysql(
        `releases it on the try's connection when every statement ran (${path})`,
        async () => {
          const t = await boot();
          const tries: TryHold[] = [];

          await runUnitInTries(
            t.adapter,
            [`UPDATE ${TABLE} SET n = n + 1 WHERE id = 1`],
            unit,
            async () => undefined,
            holdingRun(tries)
          );

          expect(tries).toHaveLength(1);
          await expectEveryTryReleased(t, tries);
        }
      );

      onMysql(
        `releases it on the try's connection when a statement fails (${path})`,
        async () => {
          const t = await boot();
          const tries: TryHold[] = [];

          // The row's key is taken, so the insert fails.
          await expect(
            runUnitInTries(
              t.adapter,
              [`INSERT INTO ${TABLE} (id, n) VALUES (1, 5)`],
              unit,
              async () => undefined,
              holdingRun(tries)
            )
          ).rejects.toBeDefined();

          expect(tries).toHaveLength(1);
          await expectEveryTryReleased(t, tries);
        }
      );

      onMysql(
        `releases it on the try's connection when a try ends waiting, before the next try (${path})`,
        async () => {
          const t = await boot();
          // Another session holds the row past one try's one-second bound, so the first try's
          // UPDATE ends waiting and the unit is tried again.
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
          const tries: TryHold[] = [];

          await runUnitInTries(
            t.adapter,
            [`UPDATE ${TABLE} SET n = n + 1 WHERE id = 1`],
            unit,
            async () => undefined,
            holdingRun(tries)
          );
          await freed;
          await holding;

          // At least one try ended waiting; each next try found the lock free.
          expect(tries.length).toBeGreaterThanOrEqual(2);
          await expectEveryTryReleased(t, tries);
        },
        30_000
      );
    }
  }
);
