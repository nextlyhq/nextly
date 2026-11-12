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
import { toSnakeCase } from "../../services/field-column-descriptor";
import { runStatement } from "../_internal/run-statement";
import { countRowsBreakingNotNull } from "../classifier/count-helpers";
import type {
  AddColumnOp,
  NextlySchemaSnapshot,
  Operation,
} from "../diff/types";
import { PromptCancelledError } from "../prompt-dispatcher/errors";
import type {
  PreCleanupExecutor,
  PreCleanupField,
} from "../pushschema-pipeline-interfaces";
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
  fields: PreCleanupField[];
  /** The schema being applied: a fill's column and its type. */
  desiredSnapshot: NextlySchemaSnapshot;
  /** Which encodings a value may arrive in: SQLite's columns store booleans and dates as numbers. */
  dialect: SupportedDialect;
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

  for (const { resolution, event } of sideEffectResolutions(args)) {
    if (resolution.kind === "provide_default") {
      const fillType = fillTypeOf(args, event);
      const validation = validateDefaultValue(
        { name: event.columnName, type: fillType },
        resolution.value,
        args.dialect
      );
      if (!validation.success) {
        throw new Error(
          `INVALID_DEFAULT_FOR_TYPE: ${event.columnName} (${fillType}) - ${validation.error}`
        );
      }
    } else if (event.kind === "add_not_null_with_nulls") {
      assertDeleteWithinThreshold(event.nullCount);
    }
    assertSafeIdent(event.tableName);
    assertSafeIdent(event.columnName);
  }
}

/**
 * The delete threshold again, on the rows as they stand after the prompt, counted through the
 * apply's transaction before its first statement (the pipeline asks it ahead of the renames and drops
 * of pre-resolution, which on MySQL commit as they run): rows can change while the prompt is open, so
 * the classifier's count can be stale. Counted with the shared counter (`countRowsBreakingNotNull`),
 * under the column's current name when the apply renames it.
 */
export async function assertLiveCounts(args: {
  tx: unknown;
  resolutions: Resolution[];
  events: ClassifierEvent[];
  /** The apply's operations: a column it renames is counted under its current name. */
  operations: readonly Operation[];
  dialect: SupportedDialect;
}): Promise<void> {
  for (const { resolution, event } of sideEffectResolutions(args)) {
    if (
      resolution.kind !== "delete_nonconforming" ||
      event.kind !== "add_not_null_with_nulls"
    ) {
      continue;
    }
    const rename = args.operations.find(
      op =>
        op.type === "rename_column" &&
        sameName(op.tableName, event.tableName) &&
        sameName(op.toColumn, event.columnName)
    );
    const rows = (
      await countRowsBreakingNotNull(args.tx, args.dialect, {
        table: event.tableName,
        column:
          rename?.type === "rename_column"
            ? rename.fromColumn
            : event.columnName,
      })
    ).total;
    assertDeleteWithinThreshold(rows);
  }
}

/**
 * Refuses deleting `rows` rows past the threshold that needs explicit
 * confirmation. Shared with the Schema Builder save writer, which keeps the
 * same threshold.
 */
export function assertDeleteWithinThreshold(rows: number): void {
  const threshold = readDeleteThreshold();
  if (rows < threshold) return;
  throw new Error(
    `DELETE_THRESHOLD_EXCEEDED: ${rows} rows >= ${threshold}; explicit confirmation required`
  );
}

/**
 * The type a fill's value must have, as the schema being applied declares the column: the declared
 * field's type, or, for a column no field declares (an extension's), the type family of the column
 * itself.
 */
function fillTypeOf(
  args: { fields: PreCleanupField[]; desiredSnapshot: NextlySchemaSnapshot },
  event: { tableName: string; columnName: string }
): string {
  const field = fieldOf(args.fields, event.tableName, event.columnName);
  if (field) return field.type;
  const column = args.desiredSnapshot.tables
    .find(t => sameName(t.name, event.tableName))
    ?.columns.find(c => sameName(c.name, event.columnName));
  return column ? typeFamilyOf(column.type) : "text";
}

/** The value family a column's SQL type takes, as `validateDefaultValue` names it. */
function typeFamilyOf(sqlType: string): string {
  const type = sqlType.toLowerCase();
  if (type === "boolean" || type === "bool" || type.startsWith("tinyint(1)")) {
    return "checkbox";
  }
  if (
    /^(tiny|small|medium|big)?int|^integer|^serial|^bigserial|^numeric|^decimal|^real|^double|^float/.test(
      type
    )
  ) {
    return "number";
  }
  if (/^(timestamp|datetime|date)/.test(type)) return "date";
  return "text";
}

/**
 * The declared field an event's column belongs to, found by the event's table and its column: a
 * camelCase field's column is its snake_case name, and a same-named field on another table is
 * another field.
 */
function fieldOf(
  fields: readonly PreCleanupField[],
  tableName: string,
  columnName: string
): PreCleanupField | undefined {
  return fields.find(
    f => f.tableName === tableName && toSnakeCase(f.name) === columnName
  );
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
 * The columns of an add_required_field_no_default event answered with a value
 * for the existing rows (provide_default), split by how they come to exist:
 * `added`, which pre-cleanup ADDS, nullable, before it fills them (the column is
 * new to the table, so the fill has nothing to name until it exists); and
 * `renamed`, which a confirmed rename brings into place before pre-cleanup runs
 * (a field renamed and made required in one apply keeps the event), so they are
 * filled where they are, and adding them again would fail. Derived from
 * `sideEffectResolutions`, so the executor and the operation rewrite that plans
 * the rest of the apply can never disagree about which columns these are.
 */
function columnsFilledByPreCleanup(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
  operations: readonly Operation[];
}): {
  added: Array<{ tableName: string; columnName: string }>;
  renamed: Array<{ tableName: string; columnName: string }>;
} {
  const renamedTo = args.operations.flatMap(op =>
    op.type === "rename_column"
      ? [{ tableName: op.tableName, columnName: op.toColumn }]
      : []
  );
  const answered = sideEffectResolutions(args)
    .filter(({ event }) => event.kind === "add_required_field_no_default")
    .map(({ event }) => ({
      tableName: event.tableName,
      columnName: event.columnName,
    }));
  const isRenamed = (column: { tableName: string; columnName: string }) =>
    renamedTo.some(
      to =>
        sameName(to.tableName, column.tableName) &&
        sameName(to.columnName, column.columnName)
    );
  return {
    added: answered.filter(column => !isRenamed(column)),
    renamed: answered.filter(isRenamed),
  };
}

/** The columns pre-cleanup adds before it fills them (`columnsFilledByPreCleanup`). */
function columnsAddedByPreCleanup(args: {
  resolutions: Resolution[];
  events: ClassifierEvent[];
  operations: readonly Operation[];
}): Array<{ tableName: string; columnName: string }> {
  return columnsFilledByPreCleanup(args).added;
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
 * this very operation. A column a confirmed rename brings, which pre-cleanup
 * fills where the rename put it, gets the same `change_column_nullable`, since
 * the rename carries no nullability. Any other operation is returned as it was.
 */
export function withAddedColumnsLeftToTighten(
  ops: readonly Operation[],
  resolutions: Resolution[],
  events: ClassifierEvent[]
): Operation[] {
  const { added, renamed } = columnsFilledByPreCleanup({
    resolutions,
    events,
    operations: ops,
  });
  if (added.length === 0 && renamed.length === 0) return [...ops];
  const tightened = ops.map(
    (op): Operation =>
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
  // A column a confirmed rename brings is made NOT NULL once filled: the rename carries no
  // nullability of its own, and without this nothing approves SQLite's rebuild for it. One the
  // plan already tightens is left to that operation.
  const alreadyTightened = (column: {
    tableName: string;
    columnName: string;
  }) =>
    tightened.some(
      op =>
        op.type === "change_column_nullable" &&
        sameName(op.tableName, column.tableName) &&
        sameName(op.columnName, column.columnName)
    );
  return [
    ...tightened,
    ...renamed
      .filter(column => !alreadyTightened(column))
      .map(
        (column): Operation => ({
          type: "change_column_nullable",
          tableName: column.tableName,
          columnName: column.columnName,
          fromNullable: true,
          toNullable: false,
        })
      ),
  ];
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
  operations: readonly Operation[];
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
    operations: readonly Operation[];
    fields: PreCleanupField[];
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
