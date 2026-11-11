// Where an unfinished conversion stands: the step its live column has reached, read from the column
// itself, never from its record.
//
// MySQL commits each schema statement on its own, so a conversion of several steps, or one step and
// the record of it, can stop between two commits, and the record can then be one step ahead of the
// column or one step behind it. The live column's type, nullability and stored values are the one
// fact a stop cannot falsify, so each run reads them before it reports or acts on a column with
// recorded progress. A column that matches no step of its conversion is left alone and reported as
// failed. A dry run and an apply ask this one question the same way.
//
// @module domains/schema/repair-columns/resume

import { sql } from "drizzle-orm";

import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectLiveColumns } from "../pipeline/diff/introspect-live";
import type { SupportedDialect } from "../services/field-column-descriptor";
import { parseColumnType } from "../value-conversion/column-type";

import { compareColumn } from "./column-comparison";
import type { RecordedProgress } from "./record";
import type {
  ColumnFinding,
  ColumnState,
  DiffersFinding,
  RepairEntity,
} from "./types";

/**
 * The steps of the list conversion: widen the column to text, rewrite each value as a list, retype
 * it as JSON. Every other conversion is one step.
 */
const LIST_CONVERSION_STEPS = 3;

/** A step's name, as the report gives it: the state the column is in once that step committed. */
export function stepName(step: number, steps: number): string {
  if (step <= 0) return "not started";
  if (step >= steps) return "converted";
  if (steps === LIST_CONVERSION_STEPS) {
    return step === 1 ? "widened to text" : "values rewritten as lists";
  }
  return `step ${String(step)} of ${String(steps)}`;
}

/** Whether `live` holds `state`'s type and nullability. */
function holds(live: ColumnState, state: ColumnState): boolean {
  return compareColumn(live, state) === null;
}

/**
 * Whether every stored value of the column is a JSON list, which is what the list conversion's
 * rewrite leaves. MySQL only: the list conversion runs in steps nowhere else.
 */
async function everyValueIsAList(
  db: unknown,
  dialect: SupportedDialect,
  table: string,
  column: string
): Promise<boolean> {
  const value = sql.identifier(column);
  const [row] = await querySqlRows<{ n: unknown }>(
    db,
    dialect,
    sql`SELECT COUNT(*) AS ${sql.identifier("n")} FROM ${sql.identifier(table)}
      WHERE ${value} IS NOT NULL
        AND NOT (CASE WHEN JSON_VALID(${value}) THEN JSON_TYPE(${value}) = 'ARRAY' ELSE FALSE END)`
  );
  return Number(row?.n ?? 0) === 0;
}

/**
 * The step the live column has reached, from 0 (nothing committed) to `steps` (converted), or null
 * where it matches no step of its conversion. `live` is null where the column does not exist.
 *
 * Between the list conversion's widening and its retyping the column is text either way; the
 * rewrite is what tells them apart, so its values are read. A column whose every value is already
 * a list has had the rewrite, which never wraps a list twice.
 */
export async function liveStepOf(
  db: unknown,
  dialect: SupportedDialect,
  progress: RecordedProgress,
  live: ColumnState | null
): Promise<number | null> {
  if (live === null) return null;
  if (holds(live, progress.to)) return progress.steps;
  if (progress.steps === LIST_CONVERSION_STEPS) {
    if (parseColumnType(live).family === "text") {
      return (await everyValueIsAList(
        db,
        dialect,
        progress.table,
        progress.column
      ))
        ? 2
        : 1;
    }
  }
  if (holds(live, progress.from)) return 0;
  return null;
}

/** Whether a finding is the difference of the column at `table`.`column`. */
export function isAt(
  finding: ColumnFinding,
  table: string,
  column: string
): boolean {
  return (
    finding.location.table.toLowerCase() === table.toLowerCase() &&
    finding.location.column.toLowerCase() === column.toLowerCase()
  );
}

/**
 * The live column at an unfinished repair's place, read from the database itself, or null where it
 * does not exist. Never inferred from what the run's findings say of the place: a column no entity
 * names any more, or one whose field now carries a pending change, still holds whatever step its
 * conversion reached.
 */
export async function readLiveState(
  db: unknown,
  dialect: SupportedDialect,
  progress: RecordedProgress
): Promise<ColumnState | null> {
  const snapshot = await introspectLiveColumns(db, dialect, [progress.table]);
  const found = snapshot.tables
    .find(t => t.name.toLowerCase() === progress.table.toLowerCase())
    ?.columns.find(c => c.name.toLowerCase() === progress.column.toLowerCase());
  if (found === undefined) return null;
  return {
    type: found.type,
    nullable: found.nullable,
    ...(found.typeModifier !== undefined
      ? { typeModifier: found.typeModifier }
      : {}),
  };
}

/**
 * The findings a run reports on their own: every one except the difference of a column with
 * unfinished progress, which is reported once, on its progress, ahead of the rest. The dry run and
 * the apply list the same columns this way.
 */
export function notResumed(
  findings: readonly ColumnFinding[],
  unfinished: readonly RecordedProgress[]
): ColumnFinding[] {
  return findings.filter(
    finding =>
      !(
        finding.kind === "differs" &&
        unfinished.some(p => isAt(finding, p.table, p.column))
      )
  );
}

/**
 * The finding an unfinished repair is reported on: its column's difference where it still has one,
 * or one made from the record where the column no longer differs, so the report still names it.
 */
export function progressFinding(
  progress: RecordedProgress,
  findings: readonly ColumnFinding[],
  entities: readonly RepairEntity[],
  live: ColumnState | null
): DiffersFinding {
  const differs = findings.find(
    (f): f is DiffersFinding =>
      f.kind === "differs" && isAt(f, progress.table, progress.column)
  );
  if (differs !== undefined) return differs;
  const entity = entities.find(
    e => e.table.toLowerCase() === progress.table.toLowerCase()
  );
  const state = live ?? progress.from;
  return {
    kind: "differs",
    location: {
      kind: entity?.kind ?? "collection",
      slug: entity?.slug ?? progress.table,
      field: progress.column,
      table: progress.table,
      column: progress.column,
      translation: false,
    },
    ...(entity?.plugin !== undefined ? { plugin: entity.plugin } : {}),
    expected: progress.to,
    live: state,
    aspects: compareColumn(state, progress.to) ?? {
      type: false,
      nullability: false,
    },
    cause: null,
    judgement: null,
    conversion: null,
    rowsRewritten: null,
  };
}

/**
 * Why a column with recorded progress is failed: it matches no step of its conversion, so neither
 * it nor its record is touched, whatever run reads it.
 */
export function noStepReason(
  progress: RecordedProgress,
  live: ColumnState | null
): string {
  const state =
    live === null
      ? "missing"
      : `${live.type}${live.nullable ? "" : " NOT NULL"}`;
  return `The column is ${state}, which matches no step of its conversion from ${progress.from.type} to ${progress.to.type}; it and its record were left as they are.`;
}
