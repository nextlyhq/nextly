// The one JSON document `nextly repair-columns --json` writes to standard output.
//
// Its envelope is the one every command's `--json` document shares: the shape's name and version,
// the command and Nextly's version, whether the run succeeded and its exit code, the command's own
// result, and its errors and warnings in the CLI's error shape. `result` holds every column the run
// reported, with the same facts as the text report, and a count of each outcome.
//
// Every key is always present. A fact that does not exist for a column, or a result for a run that
// could not run, is null: the one empty value, so a reader never has to tell a missing key from a
// renamed one. A field is never removed or given a new meaning without a new version.
//
// @module domains/schema/repair-columns/report-json

import type { SupportedDialect } from "../services/field-column-descriptor";

import { repairColumnsExitCode, type RepairColumnsExitCode } from "./exit-code";
import type { RunMode } from "./outcome";
import { countOutcomes, type OutcomeCounts, type RepairRecord } from "./report";

/** The shape's name and version. A new version for any field removed or given a new meaning. */
export const REPAIR_COLUMNS_DOCUMENT_SCHEMA = "nextly.repair-columns/1";

/** An error or a warning, in the CLI's error shape. */
export interface DocumentProblem {
  code: string;
  /** What happened, in one plain sentence. */
  message: string;
  cause: string | null;
  next: string | null;
  docs: string | null;
}

/**
 * Whether another schema change held the schema lock while the run read the database: free, held
 * (with who holds it), or unknown, where a lock could not be read (with why). Unknown is never
 * reported as free.
 */
export interface SchemaLockState {
  state: "free" | "held" | "unknown";
  /** Who holds it, in an operator's words, or null where nothing is known to. */
  holder: string | null;
  /** Why it could not be read, or null where it was. */
  unreadable: string | null;
}

export interface RepairColumnsResult {
  mode: RunMode;
  dialect: SupportedDialect;
  schemaLock: SchemaLockState;
  records: RepairRecord[];
  /**
   * How many records have each outcome, every outcome named, and how many in all. A record is one
   * difference of one column, so a column that also has a pending change counts once for each.
   */
  summary: { total: number; outcomes: OutcomeCounts };
}

export interface RepairColumnsDocument {
  schema: typeof REPAIR_COLUMNS_DOCUMENT_SCHEMA;
  command: "repair-columns";
  nextlyVersion: string;
  ok: boolean;
  exitCode: RepairColumnsExitCode;
  /** Null for a run that could not run. */
  result: RepairColumnsResult | null;
  errors: DocumentProblem[];
  warnings: DocumentProblem[];
}

/** The warning a run that reported while another schema change held the lock carries. */
export const SCHEMA_LOCK_HELD_WARNING =
  "NEXTLY_REPAIR_COLUMNS_SCHEMA_CHANGE_RUNNING";

/** The warning a run that could not read whether another schema change was running carries. */
export const SCHEMA_LOCK_UNREAD_WARNING =
  "NEXTLY_REPAIR_COLUMNS_SCHEMA_LOCK_UNREADABLE";

/** The document of a run that reported, its exit code taken from its records' outcomes. */
export function reportDocument(args: {
  nextlyVersion: string;
  mode: RunMode;
  dialect: SupportedDialect;
  schemaLock: SchemaLockState;
  records: RepairRecord[];
  warnings: DocumentProblem[];
}): RepairColumnsDocument {
  const exitCode = repairColumnsExitCode(args.records.map(r => r.outcome));
  return {
    schema: REPAIR_COLUMNS_DOCUMENT_SCHEMA,
    command: "repair-columns",
    nextlyVersion: args.nextlyVersion,
    ok: exitCode === 0,
    exitCode,
    result: {
      mode: args.mode,
      dialect: args.dialect,
      schemaLock: args.schemaLock,
      records: args.records,
      summary: {
        total: args.records.length,
        outcomes: countOutcomes(args.records),
      },
    },
    errors: [],
    warnings: args.warnings,
  };
}

/** The document of a run that could not run: no result, and the error that stopped it. */
export function couldNotRunDocument(args: {
  nextlyVersion: string;
  error: DocumentProblem;
}): RepairColumnsDocument {
  const exitCode = repairColumnsExitCode("could-not-run");
  return {
    schema: REPAIR_COLUMNS_DOCUMENT_SCHEMA,
    command: "repair-columns",
    nextlyVersion: args.nextlyVersion,
    ok: false,
    exitCode,
    result: null,
    errors: [args.error],
    warnings: [],
  };
}
