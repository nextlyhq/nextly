/**
 * The steps that bring data an earlier release stored up to date, as
 * `nextly migrate` and `nextly i18n:convert-zoned-dates` run them
 * (`runDataSteps`): which steps run, when a backup is asked for, and in what
 * order each is counted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { runDataSteps, type DataStepsDeps } from "../data-steps";
import { runConvertZonedDates } from "../i18n-convert-zoned-dates";
import type { UpgradeAdapter, UpgradeStep } from "../upgrade-step";

/** What the lock ran, in order, with what happened around it. */
const order = vi.hoisted(() => ({ events: [] as string[] }));

// The schema lock is exercised against real databases in its own suites.
// These drive the steps through a narrow adapter double that cannot hold it,
// so here the lock runs the work as given, and says when it was taken.
vi.mock("../../../domains/schema/pipeline/locks", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/schema/pipeline/locks")
  >()),
  withMigrateLock: async <T>(
    _adapter: unknown,
    _dialect: unknown,
    fn: () => Promise<T>,
    opts: { command: string }
  ) => {
    order.events.push(`lock taken by ${opts.command}`);
    return { ran: true as const, value: await fn() };
  },
}));

/** Fake adapter over the in-memory SQLite fixture. */
function makeAdapter(testDb: TestDb): UpgradeAdapter {
  return {
    tableExists: name =>
      Promise.resolve(
        !!testDb.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
          )
          .get(name)
      ),
    getDrizzle: () => testDb.db,
    dropTable: () => Promise.resolve(),
    getCapabilities: () => ({ dialect: "sqlite" as const }),
  };
}

/** A step that says it has `pending` to do and records whether it ran. */
function step(title: string, pending: number) {
  const ran: number[] = [];
  const made: UpgradeStep = {
    title,
    pending: () => Promise.resolve(pending),
    run: () => {
      ran.push(pending);
      order.events.push(`ran ${title}`);
      return Promise.resolve(pending);
    },
  };
  return { ran, step: made };
}

describe("the steps over data an earlier release stored", () => {
  let adapter: UpgradeAdapter;
  let lines: string[];

  beforeEach(async () => {
    adapter = makeAdapter(await createTestDb());
    lines = [];
    order.events = [];
  });

  /** A run as a command starts one, with what was asked recorded. */
  function run(
    steps: readonly UpgradeStep[],
    over: Partial<Pick<DataStepsDeps, "backupConfirmed" | "interactive">> & {
      answer?: boolean;
    } = {}
  ) {
    return runDataSteps({
      adapter,
      command: "nextly migrate",
      steps,
      backupConfirmed: over.backupConfirmed ?? false,
      interactive: over.interactive ?? false,
      askBackedUp: () => {
        order.events.push("asked");
        return Promise.resolve(over.answer ?? false);
      },
      log: line => lines.push(line),
      warn: line => lines.push(line),
    });
  }

  it("runs only the steps with work, under the command's lock, and reports each one's count", async () => {
    const idle = step("tidy one thing", 0);
    const busy = step("tidy another thing", 2);

    const ran = await run([idle.step, busy.step], { backupConfirmed: true });

    expect(idle.ran).toEqual([]);
    expect(busy.ran).toEqual([2]);
    expect(ran).toEqual([{ title: "tidy another thing", changed: 2 }]);
    expect(lines).toContain("tidy another thing: 2");
    expect(order.events).toEqual([
      "lock taken by nextly migrate",
      "ran tidy another thing",
    ]);
  });

  it("with work, no confirmation and nobody to ask, runs nothing, takes no lock, and names the flag and the step", async () => {
    const busy = step("tidy a thing", 1);

    await expect(run([busy.step])).rejects.toMatchObject({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      logContext: { reason: "data-steps-backup-not-confirmed" },
      publicMessage: expect.stringMatching(
        /tidy a thing: 1.*`nextly migrate --backup-confirmed`/
      ) as string,
    });
    expect(busy.ran).toEqual([]);
    expect(order.events).toEqual([]);
  });

  it("at a terminal it asks before the lock: a no runs nothing", async () => {
    const busy = step("tidy a thing", 1);

    await expect(
      run([busy.step], { interactive: true, answer: false })
    ).rejects.toMatchObject({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      logContext: { reason: "data-steps-backup-declined" },
    });
    expect(busy.ran).toEqual([]);
    expect(order.events).toEqual(["asked"]);
  });

  it("at a terminal it asks before the lock: a yes runs the step", async () => {
    const busy = step("tidy a thing", 1);

    await run([busy.step], { interactive: true, answer: true });

    expect(order.events).toEqual([
      "asked",
      "lock taken by nextly migrate",
      "ran tidy a thing",
    ]);
  });

  it("with no work it asks nothing, takes no lock and runs nothing, whatever the flag says", async () => {
    const idle = step("tidy a thing", 0);

    expect(await run([idle.step], { interactive: true })).toEqual([]);
    expect(await run([idle.step], { backupConfirmed: true })).toEqual([]);

    expect(idle.ran).toEqual([]);
    expect(order.events).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("brings each step up to date before asking the next what it has to do", async () => {
    let firstRan = false;
    const first: UpgradeStep = {
      title: "repair the bookkeeping",
      pending: () => Promise.resolve(firstRan ? 0 : 1),
      run: () => {
        firstRan = true;
        return Promise.resolve(1);
      },
    };
    // Reads what the first step repairs, so it can only count after it.
    const second: UpgradeStep = {
      title: "read what the bookkeeping holds",
      pending: () =>
        firstRan
          ? Promise.resolve(1)
          : Promise.reject(new Error("read before the repair")),
      run: () => Promise.resolve(1),
    };

    await run([first, second], { backupConfirmed: true });

    expect(lines).toContain("repair the bookkeeping: 1");
    expect(lines).toContain("read what the bookkeeping holds: 1");
  });
});

describe("nextly i18n:convert-zoned-dates", () => {
  let testDb: TestDb;
  let adapter: UpgradeAdapter;

  beforeEach(async () => {
    testDb = await createTestDb();
    adapter = makeAdapter(testDb);
    order.events = [];
  });

  /** The command's run over `steps`, the backup confirmed, with what it said. */
  async function convert(steps: readonly UpgradeStep[]) {
    const lines: string[] = [];
    const converted = await runConvertZonedDates({
      adapter,
      steps,
      backupConfirmed: true,
      interactive: false,
      log: line => lines.push(line),
      warn: line => lines.push(line),
    });
    return { converted, lines };
  }

  it("runs its step under its own name and says how many it converted", async () => {
    const busy = step("convert a column", 3);

    const { converted, lines } = await convert([busy.step]);

    expect(converted).toBe(3);
    expect(lines).toContain("convert a column: 3");
    expect(order.events).toEqual([
      "lock taken by nextly i18n:convert-zoned-dates",
      "ran convert a column",
    ]);
  });

  it("says there is nothing to do when no column is kept with a time zone", async () => {
    const { converted, lines } = await convert([step("convert", 0).step]);

    expect(converted).toBe(0);
    expect(lines.join("\n")).toContain("Nothing to do");
    expect(order.events).toEqual([]);
  });

  it("refuses a database still keeping an earlier release's migration records, running no step and naming nextly migrate", async () => {
    testDb.sqlite.exec(
      "CREATE TABLE nextly_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL)"
    );
    const busy = step("convert a column", 1);

    await expect(convert([busy.step])).rejects.toMatchObject({
      code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED",
      publicMessage: expect.stringContaining(
        "nextly migrate --backup-confirmed"
      ) as string,
    });
    expect(busy.ran).toEqual([]);
  });
});
