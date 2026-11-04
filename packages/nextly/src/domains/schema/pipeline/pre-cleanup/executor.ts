// RealPreCleanupExecutor — runs F5 pre-cleanup operations between F4's
// pre-resolution executor (renames + drops) and pushSchema (additive
// remainder). Slots into Phase D' of the F4 Option E pipeline.
//
// Per resolution kind:
//   - provide_default       UPDATE <table> SET <col> = <value> WHERE <col> IS NULL
//   - delete_nonconforming  DELETE FROM <table> WHERE <col> IS NULL
//     For a column this apply ADDS (add_required_field_no_default), both run
//     after an ADD COLUMN that creates it nullable, since the column does not
//     exist yet; the rest of the apply then only makes it NOT NULL
//     (`withAddedColumnsLeftToTighten`).
//   - make_optional         no SQL; patch desired snapshot to keep nullable=true
//   - abort                 throw PromptCancelledError; pipeline short-circuits
//
// SQL is constructed via drizzle's `sql` tag template so user-supplied
// values are parameterized at the driver level. Identifiers are validated
// against SAFE_IDENT inside sql-templates.ts and reused via sql.identifier()
// here — both layers fail loud on adversarial input.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { NextlyError } from "../../../../errors";
import { runStatement } from "../_internal/run-statement";
import type {
  AddColumnOp,
  NextlySchemaSnapshot,
  Operation,
} from "../diff/types";
import { PromptCancelledError } from "../prompt-dispatcher/errors";
import type { PreCleanupExecutor } from "../pushschema-pipeline-interfaces";
import type { ClassifierEvent, Resolution } from "../resolution/types";
import { generateSQL } from "../sql-templates";

import { applyMakeOptionalToSnapshot } from "./snapshot-patch";
import { validateDefaultValue } from "./validate-default";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Threshold for delete_nonconforming. Rows >= this require a typed-confirmation
// gate (PR 5/6 surface the gate UX in terminal/browser); PR 4's executor
// hard-fails so an unconfirmed delete can't slip through.
function readDeleteThreshold(): number {
  const env = process.env.NEXTLY_DELETE_THRESHOLD;
  if (!env) return 10000;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

function assertSafeIdent(name: string): void {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `unsafe identifier: ${name} (only [A-Za-z_][A-Za-z0-9_]* allowed)`
    );
  }
}

/**
 * Every reason pre-cleanup refuses an apply, asked of the resolutions and
 * events alone — nothing here reads or writes the database.
 *
 * Kept apart from the statements so the pipeline can ask it before its FIRST
 * statement: pre-cleanup runs after the renames, drops and constraint drops of
 * pre-resolution, and on MySQL each of those commits as it runs, so a refusal
 * discovered here afterwards would leave them — a lifted foreign key included —
 * behind a failed apply. `execute` asks it again, so no caller can skip it.
 */
export function assertPreCleanupAccepted(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
  fields: Array<{ name: string; type: string }>;
}): void {
  // Abort short-circuits before any side effect.
  for (const r of args.resolutions) {
    if (r.kind === "abort") {
      throw new PromptCancelledError();
    }
  }

  // Defense-in-depth: detect duplicate resolutions per eventId. The
  // dispatcher contract is one resolution per event; multiples would mean
  // a contract violation with ambiguous intent (e.g. UPDATE then DELETE).
  // Throw rather than guess.
  const seenEventIds = new Set<string>();
  for (const r of args.resolutions) {
    if (seenEventIds.has(r.eventId)) {
      throw new Error(
        `DUPLICATE_RESOLUTION_FOR_EVENT: ${r.eventId} has multiple resolutions attached`
      );
    }
    seenEventIds.add(r.eventId);
  }

  assertResolutionsOffered(args);

  const threshold = readDeleteThreshold();
  for (const { resolution, event } of sideEffectResolutions(args)) {
    if (resolution.kind === "provide_default") {
      const fieldType = fieldTypeOf(args.fields, event.columnName);
      const validation = validateDefaultValue(
        { name: event.columnName, type: fieldType },
        resolution.value
      );
      if (!validation.success) {
        throw new Error(
          `INVALID_DEFAULT_FOR_TYPE: ${event.columnName} (${fieldType}) - ${validation.error}`
        );
      }
    } else if (
      event.kind === "add_not_null_with_nulls" &&
      event.nullCount >= threshold
    ) {
      throw new Error(
        `DELETE_THRESHOLD_EXCEEDED: ${event.nullCount} rows >= ${threshold}; explicit confirmation required`
      );
    }
    assertSafeIdent(event.tableName);
    assertSafeIdent(event.columnName);
  }
}

/** A field's declared type, or text when the event names no declared field. */
function fieldTypeOf(
  fields: Array<{ name: string; type: string }>,
  columnName: string
): string {
  return fields.find(f => f.name === columnName)?.type ?? "text";
}

/**
 * The resolutions that issue a statement — provide_default and
 * delete_nonconforming against a not-null event — each with its event.
 * A resolution naming an unknown event id is skipped defensively.
 */
/**
 * Refuses an answer its event does not offer, before any statement. A dispatcher shows only the
 * offered answers, but a browser request names its own, so a stale or hand-made one could attach
 * any: deleting the nonconforming rows of a column this apply adds, whose every row is null, would
 * empty the table, which is why that event never offers it. An event that lists no answers
 * (a type change) has none that acts on it.
 */
function assertResolutionsOffered(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
}): void {
  const eventById = new Map(args.events.map(e => [e.id, e]));
  for (const resolution of args.resolutions) {
    const event = eventById.get(resolution.eventId);
    if (event === undefined || !("applicableResolutions" in event)) continue;
    if (event.applicableResolutions.includes(resolution.kind)) continue;
    throw NextlyError.validation({
      errors: [
        {
          path: `fields.${event.columnName}`,
          code: "RESOLUTION_NOT_OFFERED",
          message: `Table '${event.tableName}': column '${event.columnName}' cannot be answered with ${resolution.kind}, which this change does not offer (it offers ${event.applicableResolutions.join(", ")}). Nothing was changed.`,
        },
      ],
      logContext: {
        reason: "resolution-not-offered",
        eventId: event.id,
        resolution: resolution.kind,
      },
    });
  }
}

function sideEffectResolutions(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
}): Array<{
  resolution: Extract<
    Resolution,
    { kind: "provide_default" | "delete_nonconforming" }
  >;
  event: Extract<
    ClassifierEvent,
    { kind: "add_not_null_with_nulls" | "add_required_field_no_default" }
  >;
}> {
  const eventById = new Map<string, ClassifierEvent>(
    args.events.map(e => [e.id, e])
  );
  return args.resolutions.flatMap(resolution => {
    if (
      resolution.kind !== "provide_default" &&
      resolution.kind !== "delete_nonconforming"
    ) {
      return [];
    }
    const event = eventById.get(resolution.eventId);
    if (
      event === undefined ||
      (event.kind !== "add_not_null_with_nulls" &&
        event.kind !== "add_required_field_no_default")
    ) {
      return [];
    }
    return [{ resolution, event }];
  });
}

/**
 * The columns pre-cleanup ADDS before it fills or deletes over them: those of
 * a provide_default or delete_nonconforming answer to an
 * add_required_field_no_default event. The column is new to the table, so the
 * statement that fills it (or deletes the rows it leaves empty) has nothing to
 * name until it exists. Derived from `sideEffectResolutions`, so the executor
 * that adds them and the operation rewrite that stops the rest of the apply
 * adding them again can never disagree about which columns these are.
 */
function columnsAddedByPreCleanup(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
}): Array<{ tableName: string; columnName: string }> {
  return sideEffectResolutions(args)
    .filter(({ event }) => event.kind === "add_required_field_no_default")
    .map(({ event }) => ({
      tableName: event.tableName,
      columnName: event.columnName,
    }));
}

/** Whether two table or column names are the same one, as the diff spells them. */
const sameName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/**
 * `ops` for the phases that run AFTER pre-cleanup, given that pre-cleanup has
 * already added each column `columnsAddedByPreCleanup` names, nullable, and
 * filled it: that column's `add_column` becomes the `change_column_nullable`
 * that makes it NOT NULL, so it is not added a second time.
 *
 * Every later phase reads these operations: the PostgreSQL fast path emits
 * `SET NOT NULL` from them, and a nullability change routes SQLite and MySQL to
 * drizzle-kit, which re-reads the live table (now holding the nullable column)
 * and rebuilds or MODIFYs it to NOT NULL — the same road an existing column
 * made required over filled rows takes, and the rebuild it needs is approved by
 * this very operation. Any other operation is returned as it was.
 */
export function withAddedColumnsLeftToTighten(
  ops: readonly Operation[],
  resolutions: Resolution[],
  events: ClassifierEvent[]
): Operation[] {
  const added = columnsAddedByPreCleanup({ resolutions, events });
  if (added.length === 0) return [...ops];
  return ops.map(op =>
    op.type === "add_column" &&
    added.some(
      a =>
        sameName(a.tableName, op.tableName) &&
        sameName(a.columnName, op.column.name)
    )
      ? {
          type: "change_column_nullable",
          tableName: op.tableName,
          columnName: op.column.name,
          fromNullable: true,
          toNullable: op.column.nullable,
        }
      : op
  );
}

/**
 * The ADD COLUMN for each column pre-cleanup adds, keyed `table.column`: the
 * column as the desired schema declares it, but nullable, since its existing
 * rows hold nothing until the fill that follows. Rendered by the same
 * `add_column` template every other added column goes through, never a type
 * written here. A column the desired schema does not describe is refused
 * before any statement runs, rather than added in some guessed shape.
 */
function addStatementsFor(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
  desiredSnapshot: NextlySchemaSnapshot;
  dialect: SupportedDialect;
}): Map<string, string> {
  const statements = new Map<string, string>();
  for (const { tableName, columnName } of columnsAddedByPreCleanup(args)) {
    const column = args.desiredSnapshot.tables
      .find(t => sameName(t.name, tableName))
      ?.columns.find(c => sameName(c.name, columnName));
    if (column === undefined) {
      throw NextlyError.internal({
        logContext: {
          reason:
            "a required column added over existing rows is missing from the desired schema",
          table: tableName,
          column: columnName,
        },
      });
    }
    const add: AddColumnOp = {
      type: "add_column",
      tableName,
      column: { ...column, nullable: true },
    };
    statements.set(
      `${tableName}.${columnName}`,
      generateSQL(add, args.dialect)
    );
  }
  return statements;
}

export class RealPreCleanupExecutor implements PreCleanupExecutor {
  async execute(args: {
    tx: unknown;
    desiredSnapshot: NextlySchemaSnapshot;
    resolutions: Resolution[];
    events: ClassifierEvent[];
    fields: Array<{ name: string; type: string }>;
    dialect: SupportedDialect;
  }): Promise<NextlySchemaSnapshot> {
    assertPreCleanupAccepted(args);
    // Rendered up front so a column the desired schema lacks is refused
    // before the first statement below, not after some have run.
    const addStatements = addStatementsFor(args);

    // Side-effect resolutions (provide_default + delete_nonconforming), every
    // one already accepted above. drizzle's sql tag template handles
    // per-driver parameter binding.
    for (const { resolution, event } of sideEffectResolutions(args)) {
      // A column this apply adds is created (nullable) first: the UPDATE or
      // DELETE below names it, and it does not exist until this runs.
      const add = addStatements.get(`${event.tableName}.${event.columnName}`);
      if (add !== undefined) {
        await runStatement(args.tx, args.dialect, sql.raw(add));
      }
      const stmt =
        resolution.kind === "provide_default"
          ? sql`UPDATE ${sql.identifier(event.tableName)} SET ${sql.identifier(event.columnName)} = ${resolution.value} WHERE ${sql.identifier(event.columnName)} IS NULL`
          : sql`DELETE FROM ${sql.identifier(event.tableName)} WHERE ${sql.identifier(event.columnName)} IS NULL`;
      await runStatement(args.tx, args.dialect, stmt);
    }
    // make_optional is handled via snapshot patching below.

    // Apply make_optional snapshot patching (returns input unchanged when
    // no make_optional resolutions, preserving identity for the no-op case).
    return applyMakeOptionalToSnapshot(
      args.desiredSnapshot,
      args.resolutions,
      args.events
    );
  }
}
