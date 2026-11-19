// A schema dialog's push tells `writeBuilderSchemaChange` whether it may have
// changed the database: a push that succeeded did, and on MySQL, which commits
// each schema statement as it runs, a push refused part way may have too. A
// busy table's stop says itself whether anything of the change ran, and a push
// refused at its first question, asked before any statement, ran nothing.

import { describe, expect, it } from "vitest";

import { tableBusyError } from "../../busy-table/report";
import type { BusyTableOutcome, BusyTableStop } from "../../busy-table/types";
import type { PipelineResult } from "../../pipeline/pushschema-pipeline";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  FirstQuestionWatch,
  landingPush,
  nextSteps,
  partWayPush,
} from "../landing-push";

const answered = (success: boolean) => (): Promise<PipelineResult> =>
  Promise.resolve({ success, statementsExecuted: 0, renamesApplied: 0 });

/** The error a push's tries end with over a busy table, as the busy-table engine builds it. */
const busyStop = (
  outcome: BusyTableOutcome,
  appliedBefore: readonly string[] = []
) =>
  tableBusyError({
    change: "single notice",
    ended: {
      table: "single_notice",
      holder: { kind: "unnamed", reason: "no holder read" },
    },
    tries: 2,
    elapsedMs: 4000,
    appliedBefore,
    outcome,
    cause: "table-busy",
    endedAtLease: false,
  } satisfies BusyTableStop);

/** A push refused with `error`, as the pipeline answers a stop: its error in `details`. */
const refusedWith = (error: unknown) => (): Promise<PipelineResult> =>
  Promise.resolve({
    success: false,
    statementsExecuted: 0,
    renamesApplied: 0,
    error: { code: "NEXTLY_TABLE_BUSY", message: "busy", details: error },
  });

describe("landingPush", () => {
  it("counts a push that succeeded as one that changed the database", async () => {
    const tracked = landingPush(answered(true), "postgresql");
    expect(tracked.landed()).toBe(false);
    await tracked.push();
    expect(tracked.landed()).toBe(true);
  });

  it("counts a refused push as nothing applied on PostgreSQL, whose push runs in one transaction", async () => {
    const tracked = landingPush(answered(false), "postgresql");
    await tracked.push();
    expect(tracked.landed()).toBe(false);
  });

  // MySQL commits each schema statement as it runs, and SQLite's push keeps the statements that
  // ran before one that fails: a refused push on either may have changed the database.
  it.each(["mysql", "sqlite"] as const)(
    "counts a refused push on %s as possibly part applied",
    async dialect => {
      const refused = landingPush(answered(false), dialect);
      await refused.push();
      expect(refused.landed()).toBe(true);

      const thrown = landingPush(
        () => Promise.reject(new Error("the statement failed")),
        dialect
      );
      await expect(thrown.push()).rejects.toThrow("the statement failed");
      expect(thrown.landed()).toBe(true);
    }
  );

  it.each(["mysql", "sqlite"] as const)(
    "counts a busy table's stop that changed nothing as nothing applied on %s",
    async dialect => {
      const refused = landingPush(
        refusedWith(busyStop({ kind: "nothing-changed" })),
        dialect
      );
      await refused.push();
      expect(refused.landed()).toBe(false);

      const thrown = landingPush(
        () => Promise.reject(busyStop({ kind: "nothing-changed" })),
        dialect
      );
      await expect(thrown.push()).rejects.toMatchObject({
        code: "NEXTLY_TABLE_BUSY",
      });
      expect(thrown.landed()).toBe(false);
    }
  );

  it.each([
    ["stopped part way", busyStop({ kind: "part-way", committed: [1] })],
    [
      "changed nothing after a change applied before it",
      busyStop({ kind: "nothing-changed" }, ["0001_first.sql"]),
    ],
    [
      "stopped after one try of a statement that is not sent again",
      busyStop({
        kind: "no-retry",
        statementNumber: 1,
        reason: "unknown-code",
        restUndone: false,
      }),
    ],
  ])(
    "counts a busy table's stop that %s as possibly part applied on MySQL",
    async (_how, stop) => {
      const refused = landingPush(refusedWith(stop), "mysql");
      await refused.push();
      expect(refused.landed()).toBe(true);
    }
  );
});

// A writer's push that says when it failed after changing the database: a failure before keeps
// nothing (thrown as it is, so the writer withdraws the files), one after keeps the files and is
// thrown, once they are kept, saying the database holds part of the change and what to run next.
describe("partWayPush", () => {
  const refused = new NextlyError({
    code: "NEXTLY_MIGRATION_APPLY_FAILED",
    publicMessage: "The index could not be created.",
    logContext: { collection: "posts" },
  });

  it("throws a failure before the push landed as it is, for the writer to withdraw the files", async () => {
    const pushed = partWayPush(() => Promise.reject(refused));
    await expect(pushed.appliedBy()).rejects.toBe(refused);
    expect(() => pushed.throwIfFailed([])).not.toThrow();
  });

  it("answers a success as nothing held", async () => {
    const pushed = partWayPush(onLanded => {
      onLanded();
      return Promise.resolve();
    });
    await expect(pushed.appliedBy()).resolves.toBeUndefined();
    expect(() => pushed.throwIfFailed(["0002_posts.sql"])).not.toThrow();
  });

  it("keeps the files of a failure after the push landed, and says what the database holds and what to run", async () => {
    const pushed = partWayPush(onLanded => {
      onLanded();
      return Promise.reject(refused);
    });
    await expect(pushed.appliedBy()).resolves.toBe("partly-applied");

    const thrown = (() => {
      try {
        pushed.throwIfFailed(["0002_posts.sql"]);
      } catch (error) {
        return error;
      }
    })();
    // The failure's own code and words, so a caller reading the code reads it unchanged.
    expect(thrown).toMatchObject({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      statusCode: refused.statusCode,
      cause: refused,
      logContext: { collection: "posts", keptFiles: ["0002_posts.sql"] },
    });
    expect((thrown as NextlyError).publicMessage).toBe(
      "The index could not be created. The database now holds part of this change, so its " +
        "migration file 0002_posts.sql was kept and not recorded as applied. Finish the change " +
        "by hand, run `nextly migrate:resolve --applied 0002_posts.sql`; then run " +
        "`nextly migrate`, which brings the registry in step with the recorded file. Or " +
        "reverse what of it ran and run `nextly migrate`, which runs it from the start."
    );
  });

  it("names every kept file, and never a driver's own text", async () => {
    const pushed = partWayPush(onLanded => {
      onLanded();
      return Promise.reject(new Error("duplicate key value 'secret'"));
    });
    await pushed.appliedBy();

    const thrown = (() => {
      try {
        pushed.throwIfFailed(["0002_a.sql", "0003_b.sql"]);
      } catch (error) {
        return error as NextlyError;
      }
    })();
    expect(thrown?.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
    expect(thrown?.publicMessage).toContain(
      "its migration files 0002_a.sql, 0003_b.sql were kept"
    );
    // Each file's snapshot is the database as that file leaves it, so only the last is compared:
    // the earlier ones are recorded without the comparison, in run order.
    // Recording the files writes no registry row, so `nextly migrate` follows: it brings the
    // registry in step with the newest applied snapshot.
    expect(thrown?.publicMessage).toContain(
      "Finish the change by hand, record the files in order: " +
        "`nextly migrate:resolve --applied 0002_a.sql --skip-verify`, then " +
        "`nextly migrate:resolve --applied 0003_b.sql`, which checks the database against the last; " +
        "then run `nextly migrate`, which brings the registry in step with the recorded files. " +
        "Or reverse what of it ran and run `nextly migrate`, which runs them from the start."
    );
    expect(thrown?.publicMessage).not.toContain("secret");
    expect(thrown?.logMessage).toContain("secret");
  });
});

// A push refused at its first question ran nothing: the pipeline asks it before any statement.
// Any other failure on MySQL or SQLite may have run some, data-only statements included.
describe("landingPush, a push refused at its first question", () => {
  const watch = (stopped: boolean) => {
    const watched = {
      starts: 0,
      starting: () => {
        watched.starts += 1;
      },
      stopped: () => stopped,
    };
    return watched;
  };

  it.each(["mysql", "sqlite"] as const)(
    "counts a failed push on %s that stopped at its first question as nothing applied",
    async dialect => {
      const refused = landingPush(answered(false), dialect, watch(true));
      await refused.push();
      expect(refused.landed()).toBe(false);

      const thrown = landingPush(
        () => Promise.reject(new Error("cancelled at the first question")),
        dialect,
        watch(true)
      );
      await expect(thrown.push()).rejects.toThrow();
      expect(thrown.landed()).toBe(false);
    }
  );

  it.each(["mysql", "sqlite"] as const)(
    "counts a failed push on %s that went past its first question as landed",
    async dialect => {
      const refused = landingPush(answered(false), dialect, watch(false));
      await refused.push();
      expect(refused.landed()).toBe(true);
    }
  );

  it("counts a push that succeeded as landed whatever the watch says", async () => {
    const pushed = landingPush(answered(true), "sqlite", watch(true));
    await pushed.push();
    expect(pushed.landed()).toBe(true);
  });

  it("starts the watch afresh for each push", async () => {
    const watched = watch(false);
    const tracked = landingPush(answered(true), "mysql", watched);
    await tracked.push();
    await tracked.push();
    expect(watched.starts).toBe(2);
  });
});

// The watch a push's prompt dispatcher is handed through: a refusal at the first question it is
// asked says the push ran nothing; one at a later question says nothing.
describe("FirstQuestionWatch", () => {
  const asked = {
    candidates: [],
    events: [],
    classification: "safe",
    channel: "browser",
  } as unknown as Parameters<
    ReturnType<FirstQuestionWatch["watching"]>["dispatch"]
  >[0];
  const answering = (...proceeds: (boolean | "throw")[]) => ({
    dispatch: () => {
      const next = proceeds.shift();
      if (next === "throw") return Promise.reject(new Error("refused"));
      return Promise.resolve({
        proceed: next ?? true,
        confirmedRenames: [],
        resolutions: [],
      });
    },
  });

  it("notes a refusal at the first question, answered or thrown", async () => {
    const answered = new FirstQuestionWatch();
    await answered.watching(answering(false)).dispatch(asked);
    expect(answered.stopped()).toBe(true);

    const thrown = new FirstQuestionWatch();
    await expect(
      thrown.watching(answering("throw")).dispatch(asked)
    ).rejects.toThrow("refused");
    expect(thrown.stopped()).toBe(true);
  });

  it("notes nothing for a refusal after the first question", async () => {
    const watch = new FirstQuestionWatch();
    const dispatcher = watch.watching(answering(true, false));
    await dispatcher.dispatch(asked);
    await dispatcher.dispatch(asked);
    expect(watch.stopped()).toBe(false);
  });

  it("starts afresh for each push", async () => {
    const watch = new FirstQuestionWatch();
    const dispatcher = watch.watching(answering(false, true, false));
    await dispatcher.dispatch(asked);
    expect(watch.stopped()).toBe(true);
    watch.starting();
    expect(watch.stopped()).toBe(false);
    // The first question of the next push is answered: a refusal after it notes nothing.
    await dispatcher.dispatch(asked);
    await dispatcher.dispatch(asked);
    expect(watch.stopped()).toBe(false);
  });
});

// A run whose pipeline completed its apply stands, whatever fails after it in the same run: on
// PostgreSQL the apply's transaction has committed.
describe("landingPush, a run whose apply completed", () => {
  const watch = (completed: boolean) => ({
    starting: () => {},
    stopped: () => false,
    completed: () => completed,
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "counts a run on %s that failed after its apply completed as landed",
    async dialect => {
      const tracked = landingPush(
        () => Promise.reject(new Error("the version read failed")),
        dialect,
        watch(true)
      );
      await expect(tracked.push()).rejects.toThrow("the version read failed");
      expect(tracked.landed()).toBe(true);
    }
  );

  it("counts a run on PostgreSQL that failed before its apply completed as nothing applied", async () => {
    const tracked = landingPush(
      () => Promise.reject(new Error("refused")),
      "postgresql",
      watch(false)
    );
    await expect(tracked.push()).rejects.toThrow("refused");
    expect(tracked.landed()).toBe(false);
  });
});

// Only a file with a snapshot can be checked against the database; a translations table's file,
// which may come after it, has none, so it is recorded without the check, whatever its place.
describe("nextSteps, the file checked against the database", () => {
  it("checks the last file where none is named", () => {
    expect(nextSteps(["0002_a.sql", "0003_b.sql"])).toContain(
      "`nextly migrate:resolve --applied 0002_a.sql --skip-verify`, then " +
        "`nextly migrate:resolve --applied 0003_b.sql`, which checks the database against the last"
    );
  });

  it("checks the named file and records each other one without the check, in run order", () => {
    expect(
      nextSteps(["0002_main.sql", "0003_locales.sql"], "0002_main.sql")
    ).toBe(
      "Finish the change by hand, record the files in order: " +
        "`nextly migrate:resolve --applied 0002_main.sql`, then " +
        "`nextly migrate:resolve --applied 0003_locales.sql --skip-verify`; " +
        "the one without `--skip-verify` is checked against the database. " +
        "Then run `nextly migrate`, which brings the registry in step with the recorded files. " +
        "Or reverse what of it ran and run `nextly migrate`, which runs them from the start."
    );
  });
});
