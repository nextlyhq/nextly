/**
 * The run's waits for a busy table, without a database: one set of tries per table per run, one
 * total shared by every wait for a table, SQLite's tries being the whole database's, a notice for
 * each try after the first, and the engine's holder as the report carries it.
 *
 * The clock is the test's: a try that ends waiting takes its whole bound, and a pause takes its
 * length, so the schedule (pauses of 1 s, then 2 s, then 4 s) is followed exactly.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import { ownWriteLockError } from "../../migrate/migration-transaction";
import { TableWaits, tableHolderOf, type TryContext } from "../table-wait";

/** SQLite's answer to a write that waited out its busy timeout. */
const busy = () =>
  Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

function waits(bounds = { tryMs: 1_000, totalMs: 4_000 }) {
  let now = 0;
  const notices: string[] = [];
  const run = new TableWaits({
    // SQLite's watch watches nothing, so the adapter is never asked.
    adapter: {} as DrizzleAdapter,
    dialect: "sqlite",
    bounds,
    notify: line => notices.push(line),
    underSchemaLock: false,
    command: "nextly repair-columns",
    now: () => now,
    sleep: ms => {
      now += ms;
      return Promise.resolve();
    },
  });
  /** A try that waits out its bound and ends; `free` tries in, it gets the table instead. */
  const attempt = (free = Number.POSITIVE_INFINITY) => {
    let tried = 0;
    return {
      tries: () => tried,
      run: async ({ tryMs }: { tryMs: number }) => {
        tried++;
        if (tried >= free) return "read";
        now += tryMs;
        throw busy();
      },
    };
  };
  /** A try that waits `waitMs`, says its wait is over, and gets the table. */
  const reachesAfter =
    (waitMs: number, lockHeld = false) =>
    async ({ tableReached }: TryContext) => {
      now += waitMs;
      await tableReached(lockHeld);
      // Its work after the wait takes time too, which is not the table's to count.
      now += 10_000;
      return "read";
    };
  return {
    run,
    notices,
    attempt,
    reachesAfter,
    elapsed: () => now,
  };
}

describe("a run's waits for a busy table", () => {
  it("runs out after the tries the bounds allow, with a notice for each try after the first", async () => {
    const { run, notices, attempt, elapsed } = waits();
    const held = attempt();
    const waited = await run.inTries("dc_posts", held.run);
    // 0–1 s, a 1 s pause, 2–3 s; a third would start at 5 s and end past 4 s.
    expect(held.tries()).toBe(2);
    expect(notices).toHaveLength(1);
    expect(waited).toMatchObject({
      kind: "ran-out",
      lock: { table: "dc_posts", tries: 2, waitedMs: 3_000 },
    });
    expect(elapsed()).toBe(3_000);
  });

  it("makes no further try for a table whose tries ran out", async () => {
    const { run, attempt } = waits();
    await run.inTries("dc_posts", attempt().run);
    const again = attempt();
    const waited = await run.inTries("dc_posts", again.run);
    expect(again.tries()).toBe(0);
    expect(waited).toMatchObject({ kind: "ran-out", lock: { tries: 2 } });
  });

  it("on SQLite, runs out for every table at once: the holder holds the database", async () => {
    const { run, attempt } = waits();
    await run.inTries("dc_posts", attempt().run);
    const other = attempt();
    const waited = await run.inTries("dc_pages", other.run);
    expect(other.tries()).toBe(0);
    expect(waited).toMatchObject({
      kind: "ran-out",
      lock: { table: "dc_pages", holder: { wholeDatabase: true } },
    });
    expect(run.wholeDatabaseHeld()).toBe(true);
    expect(run.ranOut("dc_anything")).not.toBeNull();
  });

  it("gives a table one total per run, shared by every wait for it", async () => {
    const { run, attempt } = waits({ tryMs: 1_000, totalMs: 6_000 });
    // The first wait gets the table on its third try, at 5 s: 5 s of its 6 s are used.
    const first = attempt(3);
    expect(await run.inTries("dc_posts", first.run)).toEqual({
      kind: "done",
      value: "read",
    });
    expect(first.tries()).toBe(3);
    // The next wait has 1 s left: one try, then the table's tries have run out.
    const second = attempt();
    const waited = await run.inTries("dc_posts", second.run);
    expect(second.tries()).toBe(1);
    expect(waited).toMatchObject({
      kind: "ran-out",
      // The two tries the first wait ended, and the one the second ran out at.
      lock: { tries: 3, waitedMs: 6_000 },
    });
  });

  it("counts no try for a wait whose first try gets the table", async () => {
    const { run, attempt, notices } = waits();
    expect(await run.inTries("dc_posts", attempt(1).run)).toEqual({
      kind: "done",
      value: "read",
    });
    expect(notices).toEqual([]);
    expect(run.ranOut("dc_posts")).toBeNull();
  });

  it("charges a wait that got the table up to where its wait ended, and starts no try once less than a whole one is left", async () => {
    const { run, reachesAfter, attempt } = waits({
      tryMs: 1_000,
      totalMs: 4_000,
    });
    // Each wait gets the table just before its try's bound: 900 ms of the total each time, and
    // none of the work after it.
    for (let wait = 0; wait < 4; wait++) {
      expect(await run.inTries("dc_posts", reachesAfter(900))).toEqual({
        kind: "done",
        value: "read",
      });
    }
    // 3.6 s of 4 s are used: no whole try fits, so the next wait makes none.
    const next = attempt(1);
    const waited = await run.inTries("dc_posts", next.run);
    expect(next.tries()).toBe(0);
    expect(waited).toMatchObject({
      kind: "ran-out",
      lock: { table: "dc_posts", tries: 0, waitedMs: 3_600 },
    });
    expect(waited.kind === "ran-out" && waited.lock.nextStep).toContain(
      "raise --lock-timeout-total"
    );
  });

  it("lets a try's failure through once the try holds the table's lock, and tries no more", async () => {
    const { run, notices } = waits();
    let tried = 0;
    const lateWait = busy();
    await expect(
      run.inTries("dc_posts", async ({ tableReached }) => {
        tried++;
        await tableReached(true);
        // A later statement of the try met a lock on something else.
        throw lateWait;
      })
    ).rejects.toBe(lateWait);
    expect(tried).toBe(1);
    expect(notices).toEqual([]);
    expect(run.ranOut("dc_posts")).toBeNull();
  });

  it("charges a try that failed past its lock only for its wait, and counts it as no try", async () => {
    const { run, reachesAfter, attempt } = waits({
      tryMs: 1_000,
      totalMs: 4_000,
    });
    const afterTheLock = new Error("the record table was locked");
    const failing = reachesAfter(100, true);
    // 100 ms waiting for the table, then 10 s of work that fails waiting for something else.
    await expect(
      run.inTries("dc_posts", async context => {
        await failing(context);
        throw afterTheLock;
      })
    ).rejects.toBe(afterTheLock);
    // Only the 100 ms is the table's: its next wait still has whole tries left.
    expect(await run.inTries("dc_posts", reachesAfter(0))).toEqual({
      kind: "done",
      value: "read",
    });
    // 3.9 s left: tries at 0 and 2 s, as for a table nothing had waited for, and the failed try
    // is none of the tries the report counts.
    const held = await run.inTries("dc_posts", attempt().run);
    expect(held).toMatchObject({
      kind: "ran-out",
      lock: { tries: 2, waitedMs: 3_100 },
    });
  });

  it("names a longer single try, not a larger total, where a statement that may not run twice stopped the tries", async () => {
    const { run, attempt } = waits();
    const held = attempt();
    const waited = await run.inTries("dc_posts", held.run, () =>
      Promise.resolve({
        statementNumber: 1,
        judgement: { kind: "no-retry", reason: "trigger" },
      })
    );
    expect(held.tries()).toBe(1);
    if (waited.kind !== "ran-out") throw new Error("expected ran-out");
    expect(waited.lock.nextStep).toContain("raise --lock-timeout:");
    expect(waited.lock.nextStep).toContain("(trigger)");
    expect(waited.lock.nextStep).not.toContain("or raise --lock-timeout-total");
    // The table's later waits keep the reason.
    expect(run.ranOut("dc_posts")?.nextStep).toBe(waited.lock.nextStep);
  });

  it("waits out SQLite's answer that a table is locked as it waits out a busy database", async () => {
    for (const code of ["SQLITE_LOCKED", "SQLITE_LOCKED_SHAREDCACHE"]) {
      const { run } = waits();
      let tried = 0;
      const waited = await run.inTries("dc_posts", () => {
        tried++;
        return Promise.reject(
          Object.assign(new Error("database table is locked"), { code })
        );
      });
      // Tried again, as the schedule allows, then reported locked rather than failed.
      expect(tried).toBeGreaterThan(1);
      expect(waited).toMatchObject({
        kind: "ran-out",
        lock: { tries: tried, holder: { wholeDatabase: true } },
      });
    }
  });

  it("lets a lock this process holds through at once, whatever SQLite's code under it", async () => {
    const { run } = waits();
    const own = ownWriteLockError(
      undefined,
      Object.assign(new Error("database table is locked"), {
        code: "SQLITE_LOCKED",
      })
    );
    let tried = 0;
    await expect(
      run.inTries("dc_posts", () => {
        tried++;
        return Promise.reject(own);
      })
    ).rejects.toBe(own);
    expect(tried).toBe(1);
  });

  it("lets any other failure of a try through as it is", async () => {
    const { run } = waits();
    const refused = new Error("the column cannot be cast");
    await expect(
      run.inTries("dc_posts", () => Promise.reject(refused))
    ).rejects.toBe(refused);
  });
});

describe("the holder a lock report names", () => {
  it("carries each session a server names, without its query", () => {
    expect(
      tableHolderOf(
        {
          kind: "named",
          sessions: [
            {
              id: "4242",
              user: "site",
              clientAddress: "10.0.0.5",
              applicationName: "web",
              transactionOpenSeconds: 12,
            },
          ],
          unreadable: [],
        },
        "postgresql"
      )
    ).toEqual({
      sessions: [
        {
          id: "4242",
          user: "site",
          clientAddress: "10.0.0.5",
          application: "web",
          transactionOpenSeconds: 12,
        },
      ],
      couldNotRead: null,
      wholeDatabase: false,
    });
  });

  it("says what could not be read, and why, where a server named the holder in part or not at all", () => {
    expect(
      tableHolderOf(
        {
          kind: "named",
          sessions: [],
          unreadable: ["This user cannot see other sessions."],
        },
        "mysql"
      )
    ).toEqual({
      sessions: [],
      couldNotRead: {
        details: ["which session holds the table"],
        why: "This user cannot see other sessions.",
      },
      wholeDatabase: false,
    });
    expect(
      tableHolderOf(
        { kind: "unnamed", reason: "no spare connection" },
        "postgresql"
      ).couldNotRead
    ).toEqual({
      details: ["which session holds the table"],
      why: "no spare connection",
    });
  });

  it("on SQLite, names the whole database, which says nothing of who holds it", () => {
    expect(
      tableHolderOf({ kind: "unnamed", reason: "SQLite names none" }, "sqlite")
    ).toMatchObject({ sessions: [], wholeDatabase: true });
  });
});
