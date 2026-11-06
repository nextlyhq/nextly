// The one outcome each reported column gets, from one documented list, chosen by a fixed order.
//
// Several states can hold for one column at once: a column whose conversion stopped part-way can sit
// on a table another session holds, and a column's rows can make it both lossy and blocked. The
// first outcome in OUTCOME_ORDER that holds is the column's outcome, so two runs that saw the same
// facts report the same outcome and exit with the same code; every fact behind the others stays in
// the report. The text report and the JSON document both name the outcome from here.
//
// @module domains/schema/repair-columns/outcome

import type { ConversionClass } from "../value-conversion/types";

import { differenceClass } from "./difference-class";
import type { ColumnFinding } from "./types";

/**
 * Every outcome a column can have, first to last in the order that chooses between them.
 *
 * - `not-migrated`: the table or column does not exist; `nextly migrate` creates it.
 * - `pending-migration`: the configuration changes the field and no migration has applied it.
 * - `plugin-owned`: a plugin owns the column; it is reported and never changed.
 * - `failed`: its conversion failed in this run, with the database's reason.
 * - `interrupted`: its conversion stopped at a recorded step that a later run finishes.
 * - `unavailable-locked`: another session held its table until the wait for it ran out.
 * - `blocked`: converting it would cut, change or invent a value, or drop something it has.
 * - `needs-consent`: a dry run's lossy column, which converts only under a consent naming it.
 * - `skipped-needs-consent`: an apply's lossy column with no consent naming it.
 * - `would-convert`: a dry run's safe column.
 * - `converted`: a column this run finished converting.
 */
export const OUTCOME_ORDER = [
  "not-migrated",
  "pending-migration",
  "plugin-owned",
  "failed",
  "interrupted",
  "unavailable-locked",
  "blocked",
  "needs-consent",
  "skipped-needs-consent",
  "would-convert",
  "converted",
] as const;

export type Outcome = (typeof OUTCOME_ORDER)[number];

/** Whether the run only reports, or converts what it can. */
export type RunMode = "dry-run" | "apply";

/** One session the database reports as holding a table, as much of it as could be read. */
export interface TableHolderSession {
  /** The session's process or connection id. */
  id: string | null;
  user: string | null;
  clientAddress: string | null;
  application: string | null;
  /** How long its transaction has been open, in seconds. */
  transactionOpenSeconds: number | null;
}

/**
 * What holds a table, as the database reported it: every session it names, and, where it named
 * them only in part or not at all, what could not be read and why. The text of a holder's query is
 * never kept, since it can hold content.
 */
export interface TableHolder {
  sessions: TableHolderSession[];
  /** The details the database would not give; null where every detail was read. */
  couldNotRead: { details: string[]; why: string } | null;
  /** Another connection holds the whole database, not one table (SQLite). */
  wholeDatabase: boolean;
}

/**
 * Why a column's table could not be read or changed: the wait for it ran out. Carried on every
 * column the lock affected, so a reader of one record needs no other kind of record.
 */
export interface TableLockFacts {
  table: string;
  tries: number;
  waitedMs: number;
  holder: TableHolder;
  /** What the owner can do next, in plain words. */
  nextStep: string;
}

/** A conversion that runs in committed steps and stopped before its last. */
export interface ConversionProgress {
  /** The step the progress record names. */
  recordedStep: string;
  /** The step the live column has reached, or null where the table could not be read. */
  liveStep: string | null;
}

/** A conversion that failed in this run. */
export interface ConversionFailure {
  /** The database's reason, or why the column matches no step of its conversion. */
  reason: string;
  /** The step the column holds, for a conversion of several steps. */
  heldStep: string | null;
}

/**
 * What the run established about a column beyond its finding. A dry run establishes only the
 * lock; the rest are an apply's.
 */
export interface ColumnRunFacts {
  lock: TableLockFacts | null;
  progress: ConversionProgress | null;
  failure: ConversionFailure | null;
  /** This run finished converting the column. */
  converted: boolean;
}

/** The facts of a column nothing beyond its finding was established for. */
export const NO_RUN_FACTS: ColumnRunFacts = {
  lock: null,
  progress: null,
  failure: null,
  converted: false,
};

/** The class a finding's judgement and conversion give, or null where it was not classed. */
export function findingClass(finding: ColumnFinding): ConversionClass | null {
  if (finding.kind !== "differs" || finding.judgement === null) return null;
  return differenceClass(finding.judgement, finding.conversion);
}

/** Whether each outcome holds for the column, in OUTCOME_ORDER's terms. */
function outcomesThatHold(
  finding: ColumnFinding,
  facts: ColumnRunFacts,
  mode: RunMode
): Record<Outcome, boolean> {
  const cls = findingClass(finding);
  return {
    "not-migrated": finding.kind === "not-migrated",
    "pending-migration": finding.kind === "pending-migration",
    "plugin-owned": finding.plugin !== undefined,
    failed: facts.failure !== null,
    // A finished conversion leaves no step to finish.
    interrupted: facts.progress !== null && !facts.converted,
    "unavailable-locked":
      facts.lock !== null || finding.kind === "definition-unreadable",
    blocked: cls === "blocked",
    "needs-consent": mode === "dry-run" && cls === "lossy",
    "skipped-needs-consent": mode === "apply" && cls === "lossy",
    "would-convert": mode === "dry-run" && cls === "safe",
    converted: facts.converted,
  };
}

/**
 * The column's one outcome: the first in OUTCOME_ORDER that holds. A column that holds none
 * (an apply's safe column nothing converted, which an apply never leaves) reads as would convert,
 * so it still counts as a difference that remains.
 */
export function outcomeOf(
  finding: ColumnFinding,
  facts: ColumnRunFacts,
  mode: RunMode
): Outcome {
  const holds = outcomesThatHold(finding, facts, mode);
  return OUTCOME_ORDER.find(outcome => holds[outcome]) ?? "would-convert";
}
