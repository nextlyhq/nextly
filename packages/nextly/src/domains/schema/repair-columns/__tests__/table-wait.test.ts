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

import { TableWaits, tableHolderOf } from "../table-wait";

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
  return { run, notices, attempt, elapsed: () => now };
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
