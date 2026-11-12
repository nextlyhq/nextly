// The report of a `nextly repair-columns` run: one record per column, holding every fact the run
// established and the column's one outcome, and the text that prints it.
//
// The record is the one source of both the text report and the JSON document, so the two always
// carry the same facts. A fact that does not exist for a column is null in the record (the one
// empty value the JSON document documents) and is left out of the text.
//
// @module domains/schema/repair-columns/report

import type {
  ConversionClass,
  ConversionReason,
  ConversionReasonKind,
  RowKey,
} from "../value-conversion/types";

import { OWNER_CAN } from "./conversion/carry";
import type {
  BlockedWhileRunning,
  CannotCarry,
  NotCarried,
} from "./conversion/types";
import {
  findingClass,
  OUTCOME_ORDER,
  outcomeOf,
  type ColumnRunFacts,
  type ConversionFailure,
  type ConversionProgress,
  type Outcome,
  type RunMode,
  type TableHolderSession,
  type TableLockFacts,
} from "./outcome";
import type {
  ColumnFinding,
  ColumnState,
  DiffersFinding,
  DifferenceCause,
  LegacyShape,
  RepairEntityKind,
} from "./types";

/** A column's type and nullability, as a record holds them. */
export interface StateRecord {
  type: string;
  nullable: boolean;
  /** The size PostgreSQL reports beside the type, or null where it reports none. */
  typeModifier: string | null;
}

/** Why a column differs, as a record holds it. */
export interface CauseRecord {
  kind: DifferenceCause["kind"];
  /** The legacy shape, or null for a column a current generator still creates. */
  shape: LegacyShape | null;
  /** The first release whose generator does not create it, or null as above. */
  before: string | null;
}

/** One reason a difference is lossy or blocked, with the rows that give it, by key. */
export interface ReasonRecord {
  kind: ConversionReasonKind;
  class: ConversionClass;
  /** The first keys, up to a bound, and how many rows give it; null for a reason of the types. */
  rows: { first: RowKey[]; count: number } | null;
}

/**
 * One difference of one column of one table, with its outcome and every fact behind it.
 *
 * A column has at most two records, and they are kept apart on purpose: how its live column
 * differs from its field as last applied, which a repair converts towards, and a change to the
 * field the configuration holds and no migration has applied, which is left to that migration.
 * Merging them would give one record two things to act on and two outcomes to choose between,
 * and would hide the repair the pending migration needs first, since that migration was written
 * for the column as last applied.
 */
export interface RepairRecord {
  outcome: Outcome;
  entity: { kind: RepairEntityKind; slug: string };
  field: string;
  table: string;
  column: string;
  translation: boolean;
  plugin: string | null;
  /** What does not exist, for a column that is not migrated. */
  missing: "table" | "column" | null;
  /**
   * False only where the table's definition could not be read, so whether the column differs is
   * not known.
   */
  differenceKnown: boolean;
  live: StateRecord | null;
  expected: StateRecord | null;
  /** The field as applied and as configured, for a change no migration has applied. */
  pending: {
    applied: StateRecord | null;
    configured: StateRecord | null;
  } | null;
  cause: CauseRecord | null;
  class: ConversionClass | null;
  reasons: ReasonRecord[] | null;
  cannotCarry: CannotCarry[] | null;
  notCarried: NotCarried[] | null;
  /** What the owner can change, for a blocked column. */
  ownerCan: string[] | null;
  rowsRewritten: number | null;
  conversion: {
    steps: string[][];
    rewritesTable: boolean;
    blocks: BlockedWhileRunning;
  } | null;
  lock: TableLockFacts | null;
  progress: ConversionProgress | null;
  failure: ConversionFailure | null;
}

function stateRecord(state: ColumnState | null): StateRecord | null {
  if (state === null) return null;
  return {
    type: state.type,
    nullable: state.nullable,
    typeModifier: state.typeModifier ?? null,
  };
}

function causeRecord(cause: DifferenceCause | null): CauseRecord | null {
  if (cause === null) return null;
  return cause.kind === "legacy"
    ? { kind: cause.kind, shape: cause.shape, before: cause.before }
    : { kind: cause.kind, shape: null, before: null };
}

function reasonRecord(reason: ConversionReason): ReasonRecord {
  return {
    kind: reason.kind,
    class: reason.class,
    rows:
      reason.rows === undefined
        ? null
        : { first: [...reason.rows.first], count: reason.rows.count },
  };
}

/** The reasons that block a column; the rest clear values, which a consent can allow. */
type BlockingReasonKind = Exclude<
  ConversionReasonKind,
  "not-json" | "kept-unreadable"
>;

/** What the owner can change for each reason that blocks a column. */
const REASON_OWNER_CAN: Record<BlockingReasonKind, string> = {
  "too-long":
    "shorten the named values so each fits the new type, then run the repair again",
  "null-under-not-null":
    "give the named rows a value, or make the field optional, then run the repair again",
  "unreadable-reference-list":
    "correct the named values to a list of references, then run the repair again",
  "stored-differently": OWNER_CAN.definition,
  "no-conversion": OWNER_CAN.definition,
  "late-write": OWNER_CAN.definition,
  "cleared-under-not-null":
    "give the named rows a value the new type holds, or make the field optional, then run the repair again",
};

function isBlockingKind(
  kind: ConversionReasonKind
): kind is BlockingReasonKind {
  return Object.hasOwn(REASON_OWNER_CAN, kind);
}

/**
 * Every change the owner can make for a blocked column, each said once: for each reason that
 * blocks it, then for each thing the new type cannot keep. A reason that only clears values has
 * nothing to add, since the column is blocked whatever is cleared.
 */
function ownerCanFor(
  reasons: readonly ReasonRecord[],
  cannotCarry: readonly CannotCarry[]
): string[] {
  return [
    ...new Set([
      ...reasons
        .map(reason => reason.kind)
        .filter(isBlockingKind)
        .map(kind => REASON_OWNER_CAN[kind]),
      ...cannotCarry.map(problem => problem.ownerCan),
    ]),
  ];
}

/** The facts a column's finding gives its record, apart from where it is and the run's own. */
type FindingFacts = Omit<
  RepairRecord,
  | "outcome"
  | "entity"
  | "field"
  | "table"
  | "column"
  | "translation"
  | "plugin"
  | "lock"
  | "progress"
  | "failure"
>;

/** The facts no column has until its finding gives them. */
function emptyFacts(): FindingFacts {
  return {
    missing: null,
    differenceKnown: true,
    live: null,
    expected: null,
    pending: null,
    cause: null,
    class: null,
    reasons: null,
    cannotCarry: null,
    notCarried: null,
    ownerCan: null,
    rowsRewritten: null,
    conversion: null,
  };
}

/** The facts a finding of each kind gives. */
function findingFacts(finding: ColumnFinding): FindingFacts {
  const facts = emptyFacts();
  switch (finding.kind) {
    case "not-migrated":
      return {
        ...facts,
        missing: finding.missing,
        expected: stateRecord(finding.expected),
      };
    case "definition-unreadable":
      return {
        ...facts,
        differenceKnown: false,
        expected: stateRecord(finding.expected),
      };
    case "pending-migration":
      return {
        ...facts,
        live: stateRecord(finding.live),
        pending: {
          applied: stateRecord(finding.applied),
          configured: stateRecord(finding.configured),
        },
      };
    case "differs":
      return { ...facts, ...differsFacts(finding) };
  }
}

/** The statements a conversion runs and what they cost, as a record holds them. */
function conversionRecord(
  conversion: DiffersFinding["conversion"]
): RepairRecord["conversion"] {
  if (conversion === null) return null;
  return {
    steps: conversion.steps.map(step => [...step]),
    rewritesTable: conversion.rewritesTable,
    blocks: conversion.blocks,
  };
}

/**
 * A differing column's facts: its states and cause, and, where it was classed, its class, every
 * reason, what the new type cannot keep or has no place for, and what converting it runs.
 */
function differsFacts(finding: DiffersFinding): Partial<FindingFacts> {
  const base = {
    live: stateRecord(finding.live),
    expected: stateRecord(finding.expected),
    cause: causeRecord(finding.cause),
    rowsRewritten: finding.rowsRewritten,
    conversion: conversionRecord(finding.conversion),
  };
  // A column that was not classed (a plugin's) has no class, reasons or properties to name.
  if (finding.judgement === null) return base;
  const cls = findingClass(finding);
  const reasons = finding.judgement.reasons.map(reasonRecord);
  const cannotCarry = [...(finding.conversion?.cannotCarry ?? [])];
  return {
    ...base,
    class: cls,
    reasons,
    cannotCarry,
    notCarried: [...(finding.conversion?.notCarried ?? [])],
    ownerCan: cls === "blocked" ? ownerCanFor(reasons, cannotCarry) : null,
  };
}

/**
 * One column's record: its finding's facts, what the run established beyond it, and the one
 * outcome they give. A column a plugin owns, or one pending a migration, shows no statements: the
 * command never converts it.
 */
export function repairRecord(
  finding: ColumnFinding,
  facts: ColumnRunFacts,
  mode: RunMode
): RepairRecord {
  const outcome = outcomeOf(finding, facts, mode);
  const own = findingFacts(finding);
  const neverConverted =
    outcome === "plugin-owned" || outcome === "pending-migration";
  return {
    outcome,
    entity: { kind: finding.location.kind, slug: finding.location.slug },
    field: finding.location.field,
    table: finding.location.table,
    column: finding.location.column,
    translation: finding.location.translation,
    plugin: finding.plugin ?? null,
    ...own,
    conversion: neverConverted ? null : own.conversion,
    lock: facts.lock,
    progress: facts.progress,
    failure: facts.failure,
  };
}

/** The number of columns with each outcome, every outcome named. */
export type OutcomeCounts = Record<Outcome, number>;

export function countOutcomes(records: readonly RepairRecord[]): OutcomeCounts {
  // Every outcome named, so a reader finds a zero rather than a missing key.
  const counts = Object.fromEntries(
    OUTCOME_ORDER.map(outcome => [outcome, 0])
  ) as OutcomeCounts;
  for (const record of records) counts[record.outcome] += 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------
// The text report
// ---------------------------------------------------------------------------------------------

/** Each outcome as the text report names it. */
const OUTCOME_LABEL: Record<Outcome, string> = {
  "not-migrated": "not migrated",
  "pending-migration": "pending a migration",
  "plugin-owned": "owned by a plugin",
  failed: "failed",
  interrupted: "interrupted",
  "unavailable-locked": "unavailable, locked",
  blocked: "blocked",
  "needs-consent": "needs consent",
  "skipped-needs-consent": "skipped, needs consent",
  "would-convert": "would convert",
  converted: "converted",
};

const ENTITY_LABEL: Record<RepairEntityKind, string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
  userFields: "user fields",
};

/** A column's type and nullability as the report prints them. */
function describeState(state: StateRecord): string {
  const size =
    state.typeModifier !== null && !state.type.includes("(")
      ? `(${state.typeModifier})`
      : "";
  return `${state.type}${size} ${state.nullable ? "NULL" : "NOT NULL"}`;
}

function describeCause(cause: CauseRecord | null): string {
  if (cause === null) return "";
  return cause.kind === "legacy"
    ? `; created before ${cause.before ?? "an earlier release"}`
    : "; created by the current version's generator";
}

/** What each reason means for the column's values, as the report says it. */
const REASON_TEXT: Record<ConversionReasonKind, string> = {
  "not-json": "values that do not parse as JSON would be cleared",
  "kept-unreadable":
    "values the new type would keep in a form the field cannot read would be cleared",
  "too-long": "values longer than the new type holds would be cut",
  "stored-differently":
    "values the database would accept and store as a different value",
  "null-under-not-null": "rows hold a null where the column is to be NOT NULL",
  "unreadable-reference-list": "values cannot be read as a list of references",
  "no-conversion": "Nextly has no conversion from this type to that one",
  "late-write":
    "MySQL checks the rows and changes the column in separate transactions, so a value written meanwhile could be changed with no error",
  "cleared-under-not-null":
    "values that would be cleared, where the column does not allow a null, so a value would have to be invented",
};

function describeKey(key: RowKey): string {
  return "id" in key
    ? `id ${key.id}`
    : `parent ${key.parent} locale ${key.locale}`;
}

/** One reason with the rows that give it, by key and never by value. */
function describeReason(reason: ReasonRecord): string {
  const text = REASON_TEXT[reason.kind];
  if (reason.rows === null) return text;
  const { first, count } = reason.rows;
  const keys = first.map(describeKey).join(", ");
  const rows = count === 1 ? "1 row" : `${count} rows`;
  const shown = first.length < count ? `, first ${first.length}` : "";
  return `${text} (${rows}${shown}: ${keys})`;
}

/** One thing the new type cannot keep. */
function describeCannotCarry(problem: CannotCarry): string {
  return `cannot keep the ${problem.property} "${problem.name}": ${problem.reason}`;
}

/** What the database keeps others from doing while a conversion runs, as the report says it. */
const BLOCKS_TEXT: Record<BlockedWhileRunning, string> = {
  "reads-and-writes": "reads and writes of the table wait until it ends",
  writes: "reads continue and writes wait until it ends",
  "brief-locks":
    "reads and writes continue, apart from brief locks as it starts and ends",
};

/** A difference's class and every reason behind it, then what the new type has no place for. */
function describeJudgement(record: RepairRecord): string {
  if (record.class === null) return "";
  const reasons = [
    ...(record.reasons ?? []).map(describeReason),
    ...(record.cannotCarry ?? []).map(describeCannotCarry),
  ];
  const classed =
    reasons.length === 0
      ? ` ${record.class}.`
      : ` ${record.class}: ${reasons.join("; ")}.`;
  const notCarried = (record.notCarried ?? [])
    .map(
      item =>
        `${item.property === "characterSet" ? "character set" : "collation"} ${item.value}`
    )
    .join(", ");
  const owner =
    record.ownerCan === null || record.ownerCan.length === 0
      ? ""
      : ` The owner can: ${record.ownerCan.join("; or ")}.`;
  return notCarried === ""
    ? `${classed}${owner}`
    : `${classed}${owner} Not carried, since the new type has no place for it: ${notCarried}.`;
}

/** What converting the column costs while it runs. */
function describeCost(record: RepairRecord): string {
  if (record.conversion === null) return "";
  const rows =
    record.rowsRewritten === null
      ? ""
      : ` (${record.rowsRewritten === 1 ? "1 row" : `${record.rowsRewritten} rows`})`;
  const rewrite = record.conversion.rewritesTable
    ? `rewrites the table${rows}`
    : "changes the column without rewriting the table";
  return ` Converting it ${rewrite}; ${BLOCKS_TEXT[record.conversion.blocks]}.`;
}

/** The entity, field and column a record is about, as each line opens. */
function describeLocation(record: RepairRecord): string {
  const entity =
    record.entity.kind === "userFields"
      ? ENTITY_LABEL.userFields
      : `${ENTITY_LABEL[record.entity.kind]} "${record.entity.slug}"`;
  const where = `${record.table}.${record.column}`;
  return `${entity}, field "${record.field}" (${where}${record.translation ? ", translation table" : ""})`;
}

/** The column the field expects, in brackets, where the record names one. */
function describeExpected(record: RepairRecord): string {
  return record.expected === null
    ? ""
    : ` (expected ${describeState(record.expected)})`;
}

/** A change no migration has applied: the field as applied and as configured. */
function describePending(
  pending: NonNullable<RepairRecord["pending"]>
): string {
  const from =
    pending.applied === null ? "not applied" : describeState(pending.applied);
  const to =
    pending.configured === null ? "removed" : describeState(pending.configured);
  return ` ${from} as applied, ${to} as configured. Run \`nextly migrate:create\`, then \`nextly migrate\`.`;
}

/** What the record's own finding says, without the run's facts. */
function describeFinding(record: RepairRecord): string {
  if (record.missing !== null) {
    return ` the ${record.missing} does not exist${describeExpected(record)}. Run \`nextly migrate\`.`;
  }
  if (!record.differenceKnown) {
    return ` whether it differs could not be read: the table's definition could not be read${describeExpected(record)}.`;
  }
  if (record.pending !== null) return describePending(record.pending);
  if (record.live === null || record.expected === null) return "";
  return ` is ${describeState(record.live)}, expected ${describeState(record.expected)}${describeCause(record.cause)}.${describeJudgement(record)}${describeCost(record)}`;
}

/** The run's own facts about the column: where its conversion stopped, why it failed, its lock. */
function describeRun(record: RepairRecord): string {
  const parts: string[] = [];
  if (record.failure !== null) {
    const held =
      record.failure.heldStep === null
        ? ""
        : ` It holds the step "${record.failure.heldStep}".`;
    parts.push(` Its conversion failed: ${record.failure.reason}.${held}`);
  }
  if (record.progress !== null && record.failure === null) {
    const live =
      record.progress.liveStep === null
        ? " Its live step could not be read."
        : record.progress.liveStep === record.progress.recordedStep
          ? ""
          : ` The column has reached the step "${record.progress.liveStep}".`;
    parts.push(
      ` Its conversion stopped at the recorded step "${record.progress.recordedStep}".${live}`
    );
  }
  if (record.lock !== null) {
    parts.push(
      ` Its table "${record.lock.table}" was in use, and the wait for it ran out (see below).`
    );
  }
  if (record.plugin !== null) {
    parts.push(
      ` Owned by plugin "${record.plugin}"; reported, never changed here.`
    );
  }
  return parts.join("");
}

/** One record as the text report prints it: one line, then the statements, indented. */
export function formatRecord(record: RepairRecord): string {
  const line = `${describeLocation(record)} [${OUTCOME_LABEL[record.outcome]}]:${describeFinding(record)}${describeRun(record)}`;
  const steps = record.conversion?.steps ?? [];
  if (steps.length === 0) return line;
  const statements = steps.flatMap((step, i) =>
    step.map(statement =>
      steps.length === 1
        ? `    ${statement}`
        : `    step ${i + 1}: ${statement}`
    )
  );
  return [line, "  Statements:", ...statements].join("\n");
}

function describeSession(session: TableHolderSession): string {
  const parts = [
    session.user === null ? null : `user ${session.user}`,
    session.clientAddress === null ? null : `from ${session.clientAddress}`,
    session.application === null ? null : `application ${session.application}`,
    session.transactionOpenSeconds === null
      ? null
      : `transaction open ${session.transactionOpenSeconds}s`,
  ].filter((part): part is string => part !== null);
  const id = session.id === null ? "a session" : `session ${session.id}`;
  return parts.length === 0 ? id : `${id} (${parts.join(", ")})`;
}

/** One table whose wait ran out, as the text report says it once for all its columns. */
export function formatTableLock(lock: TableLockFacts): string {
  const { holder } = lock;
  const heldBy = holder.wholeDatabase
    ? "another connection holds the whole database"
    : holder.sessions.length === 0
      ? "the holder could not be named"
      : `held by ${holder.sessions.map(describeSession).join("; ")}`;
  const unread =
    holder.couldNotRead === null
      ? ""
      : ` Could not read ${holder.couldNotRead.details.join(", ")}: ${holder.couldNotRead.why}.`;
  const seconds = (lock.waitedMs / 1000).toFixed(1);
  return `Table "${lock.table}": ${lock.tries} ${lock.tries === 1 ? "try" : "tries"} over ${seconds}s; ${heldBy}.${unread} Next: ${lock.nextStep}`;
}

/** Each table whose wait ran out, once, in the order its columns were reported. */
export function tableLocks(records: readonly RepairRecord[]): TableLockFacts[] {
  const seen = new Map<string, TableLockFacts>();
  for (const record of records) {
    // One set of tries per table per run, so every column of a table carries the same facts.
    if (record.lock !== null) seen.set(record.lock.table, record.lock);
  }
  return [...seen.values()];
}

/** The count of each outcome, as the report's last line says it; outcomes no column has are left out. */
export function formatSummary(counts: OutcomeCounts): string {
  const said = OUTCOME_ORDER.filter(outcome => counts[outcome] > 0).map(
    outcome => `${counts[outcome]} ${OUTCOME_LABEL[outcome]}`
  );
  return said.length === 0 ? "No column differs." : `${said.join(", ")}.`;
}
