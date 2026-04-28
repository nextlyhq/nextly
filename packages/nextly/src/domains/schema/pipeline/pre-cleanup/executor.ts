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

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import type { NextlySchemaSnapshot } from "../diff/types.js";
import { PromptCancelledError } from "../prompt-dispatcher/errors.js";
import type { PreCleanupExecutor } from "../pushschema-pipeline-interfaces.js";
import type { ClassifierEvent, Resolution } from "../resolution/types.js";

import { applyMakeOptionalToSnapshot } from "./snapshot-patch.js";
import { validateDefaultValue } from "./validate-default.js";

interface ExecutableTx {
  execute: (q: unknown) => Promise<unknown>;
}

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeIdent(name: string): void {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `unsafe identifier: ${name} (only [A-Za-z_][A-Za-z0-9_]* allowed)`
    );
  }
}

// Configurable threshold — values >= this require a typed-confirmation gate.
// PR 5/6 surface the gate UX in terminal/browser; PR 4's executor just
// hard-fails so an unconfirmed delete can't slip through.
function deleteThreshold(): number {
  const env = process.env.NEXTLY_DELETE_THRESHOLD;
  if (!env) return 10000;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : 10000;
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
    // 1. Abort short-circuits before any side effect.
    for (const r of args.resolutions) {
      if (r.kind === "abort") {
        throw new PromptCancelledError();
      }
    }

    // 2. Index events for O(1) lookup by id.
    const eventById = new Map<string, ClassifierEvent>(
      args.events.map(e => [e.id, e])
    );
    const tx = args.tx as ExecutableTx;

    // 3. Run side-effect resolutions (provide_default + delete_nonconforming).
    for (const r of args.resolutions) {
      const event = eventById.get(r.eventId);
      if (!event) continue; // unknown event id - defensively skip
      if (
        event.kind !== "add_not_null_with_nulls" &&
        event.kind !== "add_required_field_no_default"
      ) {
        continue;
      }

      if (r.kind === "provide_default") {
        const field = args.fields.find(f => f.name === event.columnName);
        const fieldType = field?.type ?? "text";
        const validation = validateDefaultValue(
          { name: event.columnName, type: fieldType },
          r.value
        );
        if (!validation.success) {
          throw new Error(
            `INVALID_DEFAULT_FOR_TYPE: ${event.columnName} (${fieldType}) - ${validation.error}`
          );
        }
        assertSafeIdent(event.tableName);
        assertSafeIdent(event.columnName);
        // drizzle's sql tag template handles per-driver parameter binding.
        const stmt = sql`UPDATE ${sql.identifier(event.tableName)} SET ${sql.identifier(event.columnName)} = ${r.value} WHERE ${sql.identifier(event.columnName)} IS NULL`;
        await tx.execute(stmt);
      } else if (r.kind === "delete_nonconforming") {
        if (
          event.kind === "add_not_null_with_nulls" &&
          event.nullCount >= deleteThreshold()
        ) {
          throw new Error(
            `DELETE_THRESHOLD_EXCEEDED: ${event.nullCount} rows >= ${deleteThreshold()}; explicit confirmation required`
          );
        }
        assertSafeIdent(event.tableName);
        assertSafeIdent(event.columnName);
        const stmt = sql`DELETE FROM ${sql.identifier(event.tableName)} WHERE ${sql.identifier(event.columnName)} IS NULL`;
        await tx.execute(stmt);
      }
      // make_optional handled via snapshot patching below.
    }

    // 4. Apply make_optional snapshot patching (returns input unchanged when
    // no make_optional resolutions, preserving identity for the no-op case).
    return applyMakeOptionalToSnapshot(
      args.desiredSnapshot,
      args.resolutions,
      args.events
    );
  }
}
