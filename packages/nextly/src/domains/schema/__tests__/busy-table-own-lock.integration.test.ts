/**
 * A migration unit whose transaction holds SQLite's write lock, and a write made inside that
 * transaction on a second connection to the same file: the write waits for the unit's own lock,
 * which the unit cannot let go while it waits for the write. No wait frees that, so the unit stops
 * at once, saying this process holds the lock, rather than trying again as for a table another
 * party holds and naming that table busy.
 *
 * A write lock another connection holds on its own, outside the unit, still gets the unit's
 * tries: the unit runs once that holder lets go.
 *
 * An integration test, not a unit one: what it shows is SQLite's own locking between two real
 * connections to one file, which a stand-in could only assume. SQLite only: PostgreSQL and MySQL
 * lock rows and tables per session, and their tries are judged by the other `busy-table-*` suites.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { _resetEnvCache } from "../../../shared/lib/env";
import { busyTableBounds } from "../busy-table/bounds";
import { runUnitInTries } from "../busy-table/run-unit";
import { runMigrationStatements } from "../migrate/migration-transaction";
import {
  lockWorld,
  type LockWorld,
} from "../pipeline/__tests__/helpers/schema-lock-world";

describe("a write inside a unit's transaction on a second connection (sqlite)", () => {
  let world: LockWorld;
  let adapter: DrizzleAdapter;
  let second: DrizzleAdapter;
  const notices: string[] = [];
  const notify = (line: string) => {
    notices.push(line);
  };

  beforeAll(async () => {
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT", "1");
    vi.stubEnv("NEXTLY_LOCK_TIMEOUT_TOTAL", "4");
    _resetEnvCache();
    world = await lockWorld("sqlite", { fresh: true });
    adapter = await world.connect();
    second = await world.connect();
    // The second connection's own wait is short, so a wait it cannot win ends quickly and the
    // unit's tries, not this wait, decide how long a run takes.
    await second.executeQuery("PRAGMA busy_timeout = 100");
    await adapter.executeQuery("CREATE TABLE bol_target (id integer)");
    await adapter.executeQuery("CREATE TABLE bol_log (id integer)");
  }, 60_000);

  beforeEach(() => {
    notices.length = 0;
  });

  afterAll(async () => {
    await second?.disconnect();
    await adapter?.disconnect();
    await world?.dispose();
    vi.unstubAllEnvs();
    _resetEnvCache();
  }, 60_000);

  const bounds = () => busyTableBounds({ env: process.env });

  async function columns(): Promise<string[]> {
    const rows = await adapter.executeQuery<{ name: string }>(
      "PRAGMA table_info(bol_target)"
    );
    return rows.map(row => row.name);
  }

  /** The unit's `after`, writing on the second connection while the unit's transaction is open. */
  const writeOnSecond = async (): Promise<void> => {
    await second.executeQuery("INSERT INTO bol_log (id) VALUES (1)");
  };

  it("stops at once, naming this process as the lock's holder, and applies nothing", async () => {
    const started = Date.now();
    const error = await runUnitInTries(
      adapter,
      ["ALTER TABLE bol_target ADD COLUMN own_col integer"],
      { source: "20261114_000001_own_lock.sql", transaction: true },
      writeOnSecond,
      { bounds: bounds(), notify, appliedBefore: () => [] }
    ).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(NextlyError.is(error) ? error.code : error).toBe(
      "NEXTLY_LOCK_HELD_BY_THIS_PROCESS"
    );
    const message = (error as NextlyError).publicMessage;
    expect(message).toContain("20261114_000001_own_lock.sql");
    expect(message).toContain("this process");
    // One try: no notice of a second, and well inside the 4 s the tries would take in all.
    expect(notices).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
    // The transaction rolled back whole.
    expect(await columns()).not.toContain("own_col");
  }, 30_000);

  it("says the same where the unit runs without tries", async () => {
    const error = await runMigrationStatements(
      adapter,
      ["ALTER TABLE bol_target ADD COLUMN untried_col integer"],
      { source: "20261114_000002_own_lock.sql", transaction: true },
      writeOnSecond
    ).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(NextlyError.is(error) ? error.code : error).toBe(
      "NEXTLY_LOCK_HELD_BY_THIS_PROCESS"
    );
    expect((error as NextlyError).publicMessage).toContain(
      "20261114_000002_own_lock.sql"
    );
    expect(await columns()).not.toContain("untried_col");
  }, 30_000);

  it("still tries again for a write lock another connection holds on its own, and runs once it is let go", async () => {
    // The second connection's write transaction, opened in a flow of its own: nothing the unit
    // runs is inside it, so it can end while the unit waits between tries.
    let free: () => void = () => {};
    const freed = new Promise<void>(resolve => {
      free = resolve;
    });
    let held: () => void = () => {};
    const isHeld = new Promise<void>(resolve => {
      held = resolve;
    });
    const holding = second.transaction(async tx => {
      await tx.queryStatement(
        sql.raw("INSERT INTO bol_log (id) VALUES (2) RETURNING id")
      );
      held();
      await freed;
    });
    await isHeld;

    const ran = await runUnitInTries(
      adapter,
      ["ALTER TABLE bol_target ADD COLUMN later_col integer"],
      { source: "20261114_000003_other_holder.sql", transaction: true },
      async () => {},
      {
        bounds: bounds(),
        // The holder lets go once the unit says it tries again.
        notify: line => {
          notify(line);
          free();
        },
        appliedBefore: () => [],
      }
    ).finally(() => {
      free();
    });
    await holding;

    expect(ran).toBe(1);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(await columns()).toContain("later_col");
  }, 30_000);
});
