/**
 * The steps that bring data an earlier release stored up to date, as
 * `nextly migrate` and `nextly i18n:convert-zoned-dates` run them
 * (`runDataSteps`): which steps run, when a backup is asked for, and in what
 * order each is counted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../__tests__/fixtures/db";
import { NextlyError } from "../../../errors";
import {
  previewDataSteps,
  refusalOfSteps,
  runDataSteps,
  type DataStepsDeps,
} from "../data-steps";
import { runConvertZonedDates } from "../i18n-convert-zoned-dates";
import {
  LOCALISATION_DATA_STEPS,
  versionPasswordsStep,
} from "../upgrade-steps";
import { planWithStoredData } from "../stored-data-of-run";
import {
  NOTHING_CHANGED,
  type UpgradeAdapter,
  type UpgradeStep,
} from "../upgrade-step";

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

  it("asks the command's own precondition under the lock, before any step runs; refused, no step runs", async () => {
    const busy = step("tidy a thing", 1);
    const refusal = new Error("another change is half done");

    await expect(
      runDataSteps({
        adapter,
        command: "nextly db:sync",
        steps: [busy.step],
        backupConfirmed: true,
        interactive: false,
        log: () => {},
        warn: () => {},
        underLock: () => {
          order.events.push("precondition asked");
          return Promise.reject(refusal);
        },
      })
    ).rejects.toBe(refusal);

    expect(order.events).toEqual([
      "lock taken by nextly db:sync",
      "precondition asked",
    ]);
    expect(busy.ran).toEqual([]);
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

describe("the refusal asked of the steps before anything changes", () => {
  let adapter: UpgradeAdapter;

  beforeEach(async () => {
    adapter = makeAdapter(await createTestDb());
  });

  /** A step of `group` with work to do. */
  const busy = (group?: string): UpgradeStep => ({
    title: "tidy one thing",
    ...(group === undefined ? {} : { group }),
    pending: () => Promise.resolve(1),
    run: () => Promise.resolve(1),
  });
  /** A step of `group` whose count refuses on the database as it stands. */
  const refusing = (group?: string): UpgradeStep => ({
    title: "split what was tidied",
    ...(group === undefined ? {} : { group }),
    pending: () =>
      Promise.reject(
        new NextlyError({
          code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
          publicMessage: `Two saves at one moment. ${NOTHING_CHANGED}`,
        })
      ),
    run: () => Promise.resolve(1),
  });
  const refusalOf = (steps: readonly UpgradeStep[]) =>
    refusalOfSteps(
      { adapter, steps, log: () => undefined, warn: () => undefined },
      () => true
    );
  const previewOf = (steps: readonly UpgradeStep[]) =>
    previewDataSteps({
      adapter,
      command: "nextly migrate",
      steps,
      backupConfirmed: true,
      interactive: false,
      log: () => undefined,
      warn: () => undefined,
    });

  it("makes a later step's refusal where the earlier step with work is of another group", async () => {
    const steps = [busy("passwords"), refusing("translations")];

    expect(await refusalOf(steps)).toMatchObject({
      publicMessage: `Two saves at one moment. ${NOTHING_CHANGED}`,
    });
    expect((await previewOf(steps)).refusals).toEqual([
      `Two saves at one moment. ${NOTHING_CHANGED}`,
    ]);
  });

  // The refusing step reads what the busy one repairs, so its count holds only once that has run.
  // Broken, the refusal is made of a database the run never reaches the step with.
  it("leaves a step's refusal to the run where an earlier step of its group has work", async () => {
    const steps = [busy("translations"), refusing("translations")];

    expect(await refusalOf(steps)).toBeUndefined();
    const plan = await previewOf(steps);
    expect(plan.refusals ?? []).toEqual([]);
    // Named all the same, as one the run may make once the earlier step has run.
    expect(plan.notes).toContainEqual(
      expect.stringContaining(
        '"split what was tidied" may be refused once "tidy one thing" has run'
      )
    );
  });

  // A count that waits for an earlier step and cannot be read now is named too, rather than
  // left out of the plan. Broken, the dry run says nothing of it.
  it("names a count that waits for an earlier step and cannot be read now", async () => {
    const unreadable: UpgradeStep = {
      title: "read what was tidied",
      group: "translations",
      pending: () => Promise.reject(new Error("no such column")),
      run: () => Promise.resolve(1),
    };

    const plan = await previewOf([busy("translations"), unreadable]);

    expect(plan.notes).toContainEqual(
      expect.stringContaining(
        '"read what was tidied" could not be counted before "tidy one thing" has run'
      )
    );
  });

  /** A run of `steps` after the command applied `schemaChanges`, a backup confirmed. */
  const runOf = (steps: readonly UpgradeStep[], schemaChanges?: string) =>
    runDataSteps({
      adapter,
      command: "nextly migrate",
      steps,
      backupConfirmed: true,
      interactive: false,
      log: () => undefined,
      warn: () => undefined,
      ...(schemaChanges === undefined ? {} : { schemaChanges }),
    });

  // The refusal comes after the schema changes and the earlier step, which stay applied. Broken,
  // it still says nothing was changed.
  it("says what applied before a refusal the run makes after earlier work, and what to do next", async () => {
    const refusal = await runOf(
      [busy("translations"), refusing("translations")],
      "the 1 migration this run applied"
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(
      NextlyError.isCode(refusal, "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED")
    ).toBe(true);
    const message = (refusal as NextlyError).publicMessage;
    expect(message).toContain("Two saves at one moment.");
    expect(message).toContain("the 1 migration this run applied");
    expect(message).toContain('the step "tidy one thing" (1)');
    expect(message).toContain("stay applied");
    expect(message).toContain("then run `nextly migrate` again");
    expect(message).not.toContain(NOTHING_CHANGED);
    expect((refusal as NextlyError).logContext).toMatchObject({
      appliedBefore: {
        schemaChanges: "the 1 migration this run applied",
        steps: ["tidy one thing"],
      },
    });
  });

  // The run's first count is a refusal's first chance after the schema changes too. Broken, that
  // refusal still says nothing was changed.
  it("says what applied before a refusal the run's first count makes after the schema changes", async () => {
    const refusal = await runOf(
      [refusing("translations")],
      "the 2 migrations this run applied"
    ).then(
      () => undefined,
      (error: unknown) => error
    );

    const message = (refusal as NextlyError).publicMessage;
    expect(message).toContain("the 2 migrations this run applied");
    expect(message).not.toContain(NOTHING_CHANGED);
  });

  // What each real step repairs and reads: removing the version history's passwords changes what
  // the draft split compares, and nothing the code conversion reads. Broken (one group for both),
  // a code collision is not judged up front once the history holds a password.
  it("judges the code conversion up front past the version history's passwords, and the draft split after them", async () => {
    const real = (title: string) => {
      const found = [versionPasswordsStep, ...LOCALISATION_DATA_STEPS].find(
        step => step.title.startsWith(title)
      );
      if (!found) throw new Error(`no step "${title}"`);
      return found;
    };
    const withWork = (step: UpgradeStep): UpgradeStep => ({
      ...step,
      pending: () => Promise.resolve(1),
    });
    const refusingAs = (step: UpgradeStep): UpgradeStep => ({
      ...step,
      pending: refusing().pending,
    });
    const passwords = withWork(
      real("remove passwords kept in version history")
    );

    expect(
      await refusalOf([passwords, refusingAs(real("convert language codes"))])
    ).toBeDefined();
    expect(
      await refusalOf([passwords, refusingAs(real("split pending changes"))])
    ).toBeUndefined();
  });

  it("keeps a refusal made before anything applied as the step made it", async () => {
    await expect(runOf([refusing("translations")])).rejects.toMatchObject({
      publicMessage: `Two saves at one moment. ${NOTHING_CHANGED}`,
    });
  });

  it("takes a step with no group as one of its own", async () => {
    expect(await refusalOf([busy(), refusing()])).toMatchObject({
      publicMessage: `Two saves at one moment. ${NOTHING_CHANGED}`,
    });
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

describe("a command's dry-run plan with the data steps it takes after", () => {
  const sync = {
    changes: [{ action: "add", target: "column posts.summary" }],
    notes: ["a note of the sync"],
  };
  const stored = {
    changes: [
      { action: "hash", target: "passwords stored before this release: 2" },
    ],
    refusals: ["no backup was confirmed"],
    notes: ["a note of the steps"],
  };

  it("names the backup refusal first, since the real run refuses before it changes the schema", () => {
    expect(planWithStoredData(sync, stored, { takesSteps: true })).toEqual({
      changes: [...sync.changes, ...stored.changes],
      refusals: ["no backup was confirmed"],
      notes: ["a note of the sync", "a note of the steps"],
    });
  });

  it("keeps the backup refusal ahead of a refusal of the schema change, and leaves out the work that run never reaches", () => {
    const refusedSync = { ...sync, refusals: ["a field's address is taken"] };

    expect(
      planWithStoredData(refusedSync, stored, { takesSteps: true })
    ).toEqual({
      changes: sync.changes,
      refusals: ["no backup was confirmed", "a field's address is taken"],
      notes: ["a note of the sync"],
    });
  });

  it("is the command's own plan where it takes no data step, or none has work or refuses", () => {
    expect(planWithStoredData(sync, stored, { takesSteps: false })).toBe(sync);
    expect(
      planWithStoredData(
        sync,
        { changes: [], notes: ["could not be counted"] },
        { takesSteps: true }
      )
    ).toBe(sync);
    // A report that lists nothing adds nothing either.
    expect(
      planWithStoredData(
        sync,
        { changes: [], report: { move: [], conflicts: [], check: [] } },
        { takesSteps: true }
      )
    ).toBe(sync);
  });

  // A step can have nothing to change and still list something an editor should check, as an
  // archive no entity claims. Broken, the plan of the steps is dropped whole for holding no work.
  it("keeps what the steps list where they have no work and no refusal", () => {
    const report = {
      move: [],
      conflicts: [],
      check: ["archived translations of a collection no longer configured"],
    };

    expect(
      planWithStoredData(sync, { changes: [], report }, { takesSteps: true })
    ).toEqual({ ...sync, report });
  });
});
