/**
 * Whether a failed save's error says statements of its file stayed, so the save keeps its files
 * for `nextly migrate:resolve` rather than withdrawing them. A busy table's stop says so by its
 * outcome, read from the error the tries throw (`tableBusyError`): a committed row change leaves
 * the schema as it was, so the schema alone cannot tell.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { tableBusyError } from "../../busy-table/report";
import type { BusyTableOutcome } from "../../busy-table/types";
import { partlyApplied } from "../collection-save";

const busy = (outcome: BusyTableOutcome) =>
  tableBusyError({
    change: "20261113_000001_000_posts_update.sql",
    ended: {
      table: "dc_posts",
      holder: { kind: "unnamed", reason: "SQLite cannot name it" },
    },
    tries: 2,
    elapsedMs: 3_000,
    appliedBefore: [],
    outcome,
    cause: "table-busy",
    endedAtLease: false,
  });

describe("partlyApplied", () => {
  it("reads a busy stop that kept statements as part-way", () => {
    expect(partlyApplied(busy({ kind: "part-way", committed: [1] }))).toBe(
      true
    );
    expect(
      partlyApplied(
        busy({
          kind: "no-retry",
          statementNumber: 2,
          reason: "unread",
          restUndone: false,
        })
      )
    ).toBe(true);
  });

  it("reads a busy stop that changed nothing as not part-way", () => {
    expect(partlyApplied(busy({ kind: "nothing-changed" }))).toBe(false);
    expect(
      partlyApplied(
        busy({
          kind: "no-retry",
          statementNumber: 1,
          reason: "unread",
          restUndone: true,
        })
      )
    ).toBe(false);
  });

  it("reads a busy stop carried as the cause, as the part-way failure is", () => {
    const wrapped = new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "The save failed.",
      cause: busy({ kind: "part-way", committed: [1] }),
    });
    expect(partlyApplied(wrapped)).toBe(true);
  });
});
