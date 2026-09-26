// RealPreCleanupExecutor — runs F5 pre-cleanup operations between F4's
// pre-resolution executor (renames + drops) and pushSchema (additive
// remainder). Slots into Phase D' of the F4 Option E pipeline.
//
// Per resolution kind:
//   - provide_default       UPDATE <table> SET <col> = <value> WHERE <col> IS NULL
//   - delete_nonconforming  DELETE FROM <table> WHERE <col> IS NULL
//   - make_optional         no SQL; patch desired snapshot to keep nullable=true
//   - abort                 throw PromptCancelledError; pipeline short-circuits
//
// SQL is constructed via drizzle's `sql` tag template so user-supplied
// values are parameterized at the driver level. Identifiers are validated
// against SAFE_IDENT inside sql-templates.ts and reused via sql.identifier()
// here — both layers fail loud on adversarial input.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import { runStatement } from "../_internal/run-statement";
import type { NextlySchemaSnapshot } from "../diff/types";
import { PromptCancelledError } from "../prompt-dispatcher/errors";
import type { PreCleanupExecutor } from "../pushschema-pipeline-interfaces";
import type { ClassifierEvent, Resolution } from "../resolution/types";

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

    // Side-effect resolutions (provide_default + delete_nonconforming), every
    // one already accepted above. drizzle's sql tag template handles
    // per-driver parameter binding.
    for (const { resolution, event } of sideEffectResolutions(args)) {
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
