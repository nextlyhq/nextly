// A schema dialog's push tells `writeBuilderSchemaChange` whether it may have
// changed the database: a push that succeeded did, and on MySQL, which commits
// each schema statement as it runs, a push refused part way may have too. A
// busy table's stop says itself whether anything of the change ran.

import { describe, expect, it } from "vitest";

import { tableBusyError } from "../../busy-table/report";
import type { BusyTableOutcome, BusyTableStop } from "../../busy-table/types";
import type { PipelineResult } from "../../pipeline/pushschema-pipeline";
import { landingPush } from "../landing-push";

const answered = (success: boolean) => (): Promise<PipelineResult> =>
  Promise.resolve({ success, statementsExecuted: 0, renamesApplied: 0 });

const desired = {} as Parameters<ReturnType<typeof landingPush>["push"]>[0];

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
    await tracked.push(desired);
    expect(tracked.landed()).toBe(true);
  });

  it("counts a refused push as nothing applied on PostgreSQL, whose push runs in one transaction", async () => {
    const tracked = landingPush(answered(false), "postgresql");
    await tracked.push(desired);
    expect(tracked.landed()).toBe(false);
  });

  // MySQL commits each schema statement as it runs, and SQLite's push keeps the statements that
  // ran before one that fails: a refused push on either may have changed the database.
  it.each(["mysql", "sqlite"] as const)(
    "counts a refused push on %s as possibly part applied",
    async dialect => {
      const refused = landingPush(answered(false), dialect);
      await refused.push(desired);
      expect(refused.landed()).toBe(true);

      const thrown = landingPush(
        () => Promise.reject(new Error("the statement failed")),
        dialect
      );
      await expect(thrown.push(desired)).rejects.toThrow(
        "the statement failed"
      );
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
      await refused.push(desired);
      expect(refused.landed()).toBe(false);

      const thrown = landingPush(
        () => Promise.reject(busyStop({ kind: "nothing-changed" })),
        dialect
      );
      await expect(thrown.push(desired)).rejects.toMatchObject({
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
      await refused.push(desired);
      expect(refused.landed()).toBe(true);
    }
  );
});
