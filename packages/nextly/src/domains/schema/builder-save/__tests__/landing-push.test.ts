// A schema dialog's push tells `writeBuilderSchemaChange` whether it may have
// changed the database: a push that succeeded did, and on MySQL, which commits
// each schema statement as it runs, a push refused part way may have too. A
// busy table's stop says itself whether anything of the change ran, and the
// tables the change reaches, read before and after the push, say whether a
// failed one changed anything.

import { describe, expect, it, vi } from "vitest";

// The tables as the database answers each read, in turn: the test sets what each read returns.
const live = vi.hoisted(() => ({ reads: [] as unknown[], fail: false }));
vi.mock("../../pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: () => {
    if (live.fail) return Promise.reject(new Error("the read failed"));
    return Promise.resolve(live.reads.shift() ?? { tables: [] });
  },
}));
// Compared by content here; the reconcile's own diff is what the integration tests use.
vi.mock("../../migrate/drift-reconcile", () => ({
  snapshotsEquivalent: (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b),
}));

import { tableBusyError } from "../../busy-table/report";
import type { BusyTableOutcome, BusyTableStop } from "../../busy-table/types";
import type { PipelineResult } from "../../pipeline/pushschema-pipeline";
import { NextlyError } from "../../../../errors/nextly-error";
import { landingPush, partWayPush } from "../landing-push";

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
        "by hand and run `nextly migrate:resolve --applied 0002_posts.sql`, or reverse what of " +
        "it ran and run `nextly migrate`, which runs it from the start."
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
    expect(thrown?.publicMessage).toContain(
      "Finish the change by hand, then record the files in order: " +
        "`nextly migrate:resolve --applied 0002_a.sql --skip-verify`, then " +
        "`nextly migrate:resolve --applied 0003_b.sql`, which checks the database against the last; " +
        "or reverse what of it ran and run `nextly migrate`, which runs them from the start."
    );
    expect(thrown?.publicMessage).not.toContain("secret");
    expect(thrown?.logMessage).toContain("secret");
  });
});

// Whether a failed push changed anything, read from the tables it can reach: before the push and
// after. A push the pipeline refused before any statement ran leaves them as they were.
describe("landingPush, reading the tables the change reaches", () => {
  const table = (columns: string[]) => ({
    tables: [{ name: "dc_posts", columns }],
  });
  const reached = {
    adapter: {
      getDrizzle: () => ({}),
      getCapabilities: () => ({ dialect: "mysql" as const }),
      tableExists: () => Promise.resolve(true),
    },
    tables: ["dc_posts"],
  };

  it.each(["mysql", "sqlite"] as const)(
    "counts a failed push on %s that left the tables as they were as nothing applied",
    async dialect => {
      live.fail = false;
      live.reads = [table(["id", "title"]), table(["id", "title"])];
      const refused = landingPush(answered(false), dialect, reached);
      await refused.push();
      expect(refused.landed()).toBe(false);

      live.reads = [table(["id", "title"]), table(["id", "title"])];
      const thrown = landingPush(
        () => Promise.reject(new Error("refused before any statement")),
        dialect,
        reached
      );
      await expect(thrown.push()).rejects.toThrow();
      expect(thrown.landed()).toBe(false);
    }
  );

  it.each(["mysql", "sqlite"] as const)(
    "counts a failed push on %s that changed a table as landed",
    async dialect => {
      live.fail = false;
      live.reads = [table(["id", "title"]), table(["id", "title", "body"])];
      const refused = landingPush(answered(false), dialect, reached);
      await refused.push();
      expect(refused.landed()).toBe(true);
    }
  );

  it("counts a failed push as landed where the tables cannot be read", async () => {
    live.fail = true;
    const refused = landingPush(answered(false), "mysql", reached);
    await refused.push();
    expect(refused.landed()).toBe(true);
    live.fail = false;
  });

  it("reads nothing on PostgreSQL, whose failed push leaves nothing", async () => {
    live.fail = false;
    live.reads = [table(["id"]), table(["id", "body"])];
    const refused = landingPush(answered(false), "postgresql", reached);
    await refused.push();
    expect(refused.landed()).toBe(false);
    // Both reads still waiting: neither was taken.
    expect(live.reads).toHaveLength(2);
  });
});
