// A schema dialog's push tells `writeBuilderSchemaChange` whether it may have
// changed the database: a push that succeeded did, and on MySQL, which commits
// each schema statement as it runs, a push refused part way may have too. A
// busy table's stop says itself whether anything of the change ran.

import { describe, expect, it } from "vitest";

import { tableBusyError } from "../../../domains/schema/busy-table/report";
import type {
  BusyTableOutcome,
  BusyTableStop,
} from "../../../domains/schema/busy-table/types";
import type { PipelineResult } from "../../../domains/schema/pipeline/pushschema-pipeline";
import { landingPush } from "../builder-save-change";

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

  it("counts a refused push as nothing applied where the schema change is one transaction", async () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const tracked = landingPush(answered(false), dialect);
      await tracked.push(desired);
      expect(tracked.landed()).toBe(false);
    }
  });

  it("counts a refused push on MySQL as possibly part applied", async () => {
    const refused = landingPush(answered(false), "mysql");
    await refused.push(desired);
    expect(refused.landed()).toBe(true);

    const thrown = landingPush(
      () => Promise.reject(new Error("the statement failed")),
      "mysql"
    );
    await expect(thrown.push(desired)).rejects.toThrow("the statement failed");
    expect(thrown.landed()).toBe(true);
  });

  it("counts a busy table's stop that changed nothing as nothing applied on MySQL", async () => {
    const refused = landingPush(
      refusedWith(busyStop({ kind: "nothing-changed" })),
      "mysql"
    );
    await refused.push(desired);
    expect(refused.landed()).toBe(false);

    const thrown = landingPush(
      () => Promise.reject(busyStop({ kind: "nothing-changed" })),
      "mysql"
    );
    await expect(thrown.push(desired)).rejects.toMatchObject({
      code: "NEXTLY_TABLE_BUSY",
    });
    expect(thrown.landed()).toBe(false);
  });

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
