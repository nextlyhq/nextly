// The code `nextly repair-columns` exits with: one for each of its four results, fixed once
// released, so CI can tell them apart.
//
// 0 and 1 are every command's (done, could not run); 2 is the code every verdict command exits with
// when it finds something out of step; 3 is this command's own. When more than one result holds,
// the first in this order wins: could not run, then failed or interrupted, then differences remain.
//
// @module domains/schema/repair-columns/exit-code

import type { Outcome } from "./outcome";

export const REPAIR_COLUMNS_EXIT = {
  /** No difference remains. */
  noDifference: 0,
  /** The command could not run: no database, an invalid configuration, the lock not taken. */
  couldNotRun: 1,
  /** Differences remain: any outcome other than converted, failed or interrupted. */
  differencesRemain: 2,
  /** At least one conversion failed or was interrupted. */
  failedOrInterrupted: 3,
} as const;

export type RepairColumnsExitCode =
  (typeof REPAIR_COLUMNS_EXIT)[keyof typeof REPAIR_COLUMNS_EXIT];

/** The lines `--help` ends with, after the codes every command shares. */
export const REPAIR_COLUMNS_EXIT_HELP: readonly string[] = [
  `${REPAIR_COLUMNS_EXIT.differencesRemain} differences remain (a column that could not be read counts as one)`,
  `${REPAIR_COLUMNS_EXIT.failedOrInterrupted} a conversion failed or was interrupted`,
];

/**
 * The run's code from the outcome of every column it reported. A run that could not run has no
 * outcomes to weigh; one that did exits on the first result that holds.
 */
export function repairColumnsExitCode(
  outcomes: readonly Outcome[] | "could-not-run"
): RepairColumnsExitCode {
  if (outcomes === "could-not-run") return REPAIR_COLUMNS_EXIT.couldNotRun;
  if (outcomes.some(o => o === "failed" || o === "interrupted")) {
    return REPAIR_COLUMNS_EXIT.failedOrInterrupted;
  }
  if (outcomes.some(o => o !== "converted")) {
    return REPAIR_COLUMNS_EXIT.differencesRemain;
  }
  return REPAIR_COLUMNS_EXIT.noDifference;
}
