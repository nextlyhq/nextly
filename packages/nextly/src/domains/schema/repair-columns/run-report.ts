// A `nextly repair-columns` run without `--apply`: read the database, report every column whose type
// or nullability differs from its field, and change nothing.
//
// It never takes the schema lock, since taking it writes a claim. It reads who holds it instead,
// and when another schema change does, it still reports and says the report may change once that
// change ends.
//
// @module domains/schema/repair-columns/run-report

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { BusyTableBounds } from "../busy-table/bounds";

import {
  describeHolder,
  readSchemaLockState,
  type SchemaLockReading,
} from "../pipeline/schema-lock";
import type { SupportedDialect } from "../services/field-column-descriptor";

import { findColumnDifferences } from "./find-differences";
import { NO_RUN_FACTS, type TableLockFacts } from "./outcome";
import { readUnfinishedRepairs, type RecordedProgress } from "./record";
import {
  formatRecord,
  formatSummary,
  formatTableLock,
  repairRecord,
  tableLocks,
  type RepairRecord,
} from "./report";
import {
  reportDocument,
  SCHEMA_LOCK_HELD_WARNING,
  SCHEMA_LOCK_UNREAD_WARNING,
  type DocumentProblem,
  type RepairColumnsDocument,
  type SchemaLockState,
} from "./report-json";
import {
  liveStepOf,
  noStepReason,
  notResumed,
  progressFinding,
  readLiveState,
  progressStepName,
} from "./resume";
import { TableWaits } from "./table-wait";
import type { ColumnFinding, RepairEntity } from "./types";

/** Why the lock tables were not read: the database's tries had already run out. */
const DATABASE_HELD =
  "another connection held the whole database past the run's tries, so Nextly's lock tables could not be read";

/** The command a dry run's next step names. */
const DRY_RUN_COMMAND = "nextly repair-columns";

/** How a run waits for a table another session is using: its bounds, and where notices go. */
export interface TableWaitSettings {
  bounds: BusyTableBounds;
  /** Prints one line on standard error at each try after the first. */
  notify: (line: string) => void;
}

/** The warning a report made while another schema change held the lock carries. */
function schemaLockWarning(holder: string): DocumentProblem {
  return {
    code: SCHEMA_LOCK_HELD_WARNING,
    message:
      "Another schema change is running, so this report may change once it ends.",
    cause: holder,
    next: "Run `nextly repair-columns` again once that change ends.",
    docs: null,
  };
}

/** The warning a report made without knowing whether another schema change was running carries. */
function schemaLockUnreadWarning(reason: string): DocumentProblem {
  return {
    code: SCHEMA_LOCK_UNREAD_WARNING,
    message:
      "Whether another schema change is running could not be read, so this report may change once any such change ends.",
    cause: `${reason}.`,
    next: "Run `nextly repair-columns` again as a database user that can read Nextly's lock tables, once no other connection holds the database.",
    docs: null,
  };
}

/** The lock as the document reports it, and the warning it gives, if any. */
function schemaLockFacts(reading: SchemaLockReading): {
  schemaLock: SchemaLockState;
  warnings: DocumentProblem[];
} {
  switch (reading.state) {
    case "free":
      return {
        schemaLock: { state: "free", holder: null, unreadable: null },
        warnings: [],
      };
    case "held": {
      const holder = describeHolder(reading.holder);
      return {
        schemaLock: { state: "held", holder, unreadable: null },
        warnings: [schemaLockWarning(holder)],
      };
    }
    case "unknown":
      return {
        schemaLock: {
          state: "unknown",
          holder: null,
          unreadable: reading.reason,
        },
        warnings: [schemaLockUnreadWarning(reading.reason)],
      };
  }
}

/**
 * The lock facts of a column whose table's definition could not be read because another
 * connection held the whole database: the one read this run made, how long it took, and why the
 * holder cannot be named.
 */
function heldDatabaseLock(table: string, waitedMs: number): TableLockFacts {
  return {
    table,
    tries: 1,
    waitedMs,
    holder: {
      sessions: [],
      couldNotRead: {
        details: ["which connection holds the database"],
        why: "SQLite reports only that the database is locked, not who holds it",
      },
      wholeDatabase: true,
    },
    nextStep:
      "run the report again once the connection holding the database ends, or end that connection",
  };
}

/** The document of a dry run over `entities`. Reads the database and changes nothing. */
export async function dryRunReport(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  /** The entities to compare, or how to read them, in the run's waits. */
  entities:
    | readonly RepairEntity[]
    | ((waits: TableWaits | undefined) => Promise<readonly RepairEntity[]>);
  nextlyVersion: string;
  /**
   * How to wait for a table another session is using. Left out, each read runs once and a table
   * that stays closed is waited for as the database's own settings wait.
   */
  tableWait?: TableWaitSettings;
}): Promise<RepairColumnsDocument> {
  const { adapter, dialect } = args;
  const waits =
    args.tableWait === undefined
      ? undefined
      : new TableWaits({
          adapter,
          dialect,
          ...args.tableWait,
          underSchemaLock: false,
          command: DRY_RUN_COMMAND,
        });
  const started = Date.now();
  const entities =
    typeof args.entities === "function"
      ? await args.entities(waits)
      : args.entities;
  const findings = await findColumnDifferences({
    db: adapter.getDrizzle(),
    dialect,
    entities,
    ...(waits === undefined ? {} : { waits }),
  });
  const readMs = Date.now() - started;
  // Read after the tables: where another connection held the whole database past its tries, the
  // lock tables cannot be read either, and reading them would wait again outside the tries.
  const { schemaLock, warnings } = schemaLockFacts(
    waits?.wholeDatabaseHeld() === true
      ? { state: "unknown", reason: DATABASE_HELD }
      : await readSchemaLockState(adapter)
  );
  const unfinished = await unfinishedRecords(
    { adapter, dialect, entities },
    findings,
    waits
  );
  return reportDocument({
    nextlyVersion: args.nextlyVersion,
    mode: "dry-run",
    dialect,
    schemaLock,
    records: [
      ...unfinished.records,
      ...notResumed(findings, unfinished.places).map(finding =>
        repairRecord(
          finding,
          { ...NO_RUN_FACTS, lock: findingLock(finding, readMs) },
          "dry-run"
        )
      ),
    ],
    warnings,
  });
}

/**
 * The lock that kept a finding's rows or definition from being read: the one its table's tries
 * ended with, or, for a definition read once with no tries, that one read.
 */
export function findingLock(
  finding: ColumnFinding,
  readMs: number
): TableLockFacts | null {
  if (finding.kind === "differs" || finding.kind === "definition-unreadable") {
    if (finding.lock !== undefined) return finding.lock;
  }
  return finding.kind === "definition-unreadable"
    ? heldDatabaseLock(finding.location.table, readMs)
    : null;
}

/**
 * Each conversion an earlier `--apply` run left at a recorded step, reported as interrupted with
 * the step its record names and the step its live column has reached. Read only: a dry run
 * finishes nothing. A column whose table's tries run out stays interrupted at its recorded step,
 * with the lock that kept its live step from being read.
 */
async function unfinishedRecords(
  args: {
    adapter: DrizzleAdapter;
    dialect: SupportedDialect;
    entities: readonly RepairEntity[];
  },
  findings: readonly ColumnFinding[],
  waits: TableWaits | undefined
): Promise<{ records: RepairRecord[]; places: RecordedProgress[] }> {
  const db = args.adapter.getDrizzle();
  const places = await readUnfinishedRepairs(db, args.dialect);
  const records: RepairRecord[] = [];
  for (const progress of places) {
    const readStep = async (on: unknown) => {
      const live = await readLiveState(on, args.dialect, progress);
      return {
        live,
        reached: await liveStepOf(on, args.dialect, progress, live),
      };
    };
    const read =
      waits === undefined
        ? { kind: "done" as const, value: await readStep(db) }
        : await waits.read(progress.table, readStep);
    if (read.kind === "ran-out") {
      records.push(
        repairRecord(
          progressFinding(progress, findings, args.entities, null),
          {
            ...NO_RUN_FACTS,
            progress: {
              recordedStep: progressStepName(progress, progress.step),
              liveStep: null,
            },
            lock: read.lock,
          },
          "dry-run"
        )
      );
      continue;
    }
    const { live, reached } = read.value;
    records.push(
      repairRecord(
        progressFinding(progress, findings, args.entities, live),
        {
          ...NO_RUN_FACTS,
          progress: {
            recordedStep: progressStepName(progress, progress.step),
            liveStep:
              reached === null ? null : progressStepName(progress, reached),
          },
          // A column matching no step of its conversion is failed, and left to its owner.
          failure:
            reached === null
              ? { reason: noStepReason(progress, live), heldStep: null }
              : null,
        },
        "dry-run"
      )
    );
  }
  return { records, places };
}

/** One printed block of the text report, and whether it is a finding that needs attention. */
export interface ReportLine {
  text: string;
  level: "info" | "warn" | "success";
}

/**
 * The text report of a run's document: what was compared, a running schema change, each column,
 * each table the run could not get, then the count of each outcome. It says what the document
 * says, from the same records.
 */
export function formatReport(document: RepairColumnsDocument): ReportLine[] {
  const result = document.result;
  if (result === null) return [];
  const lines: ReportLine[] = [
    {
      level: "info",
      text:
        result.mode === "dry-run"
          ? "Each column Nextly builds from field definitions, compared with its field as last migrated. Nothing is changed."
          : "Each column Nextly builds from field definitions, compared with its field as last migrated, and converted where it is safe.",
    },
  ];
  // Each warning as the document gives it: what happened, why, and what to do next.
  for (const warning of document.warnings) {
    const cause = warning.cause === null ? "" : ` ${warning.cause}`;
    const next = warning.next === null ? "" : ` Next: ${warning.next}`;
    lines.push({ level: "warn", text: `${warning.message}${cause}${next}` });
  }
  for (const record of result.records) {
    lines.push({ level: "warn", text: formatRecord(record) });
  }
  const locks = tableLocks(result.records);
  if (locks.length > 0) {
    lines.push({
      level: "warn",
      text: [
        "Tables the run could not get:",
        ...locks.map(lock => `  ${formatTableLock(lock)}`),
      ].join("\n"),
    });
  }
  lines.push(
    result.records.length === 0
      ? { level: "success", text: "Every column matches its field." }
      : { level: "info", text: formatSummary(result.summary.outcomes) }
  );
  return lines;
}
