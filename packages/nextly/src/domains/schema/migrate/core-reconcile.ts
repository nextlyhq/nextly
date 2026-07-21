/**
 * `nextly migrate` Phase 1 — core schema reconciliation (spec §4.6).
 *
 * Introspects the live core tables, diffs against `getCoreSchema(dialect)`,
 * classifies under `production-strict` (destructive core changes are refused
 * unless NEXTLY_ALLOW_CORE_DESTRUCTIVE=1), applies additive changes via the
 * existing `freshPushSchema` core-push path (drizzle-kit ALTER/ADD COLUMN),
 * and records one `core_apply` event in `nextly_schema_events`.
 *
 * The introspect + apply steps are injectable for testing the orchestration
 * without running drizzle-kit; the defaults wire the real implementations.
 *
 * @module domains/schema/migrate/core-reconcile
 * @since v0.0.3-alpha (Plan C2)
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getDialectTables } from "../../../database/index";
import { NextlyError } from "../../../errors";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../../schemas";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  classifyForMode,
  type ClassifierMode,
} from "../pipeline/classifier/modes";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { freshPushSchema, type FreshPushDialect } from "../pipeline/fresh-push";

import { resolveSafeNullabilityOps } from "./resolve-safe-nullability";

type Dialect = "postgresql" | "mysql" | "sqlite";

interface LoggerLike {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface ReconcileCoreDeps {
  db: unknown;
  dialect: Dialect;
  logger?: LoggerLike;
  /** NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 lets a destructive core change proceed. */
  allowDestructive?: boolean;
  /** Classifier mode for the core diff. Default: "production-strict". */
  mode?: ClassifierMode;
  /**
   * Called (non-strict path only) when the diff contains destructive ops.
   * Return true to proceed, false to abort with NEXTLY_CORE_DESTRUCTIVE_REFUSED.
   */
  confirmDestructive?: (reasons: string[]) => Promise<boolean>;
  /** Injectable for tests. Default: introspectLiveSnapshot. */
  introspect?: (
    db: unknown,
    dialect: SupportedDialect,
    tableNames: string[]
  ) => Promise<NextlySchemaSnapshot>;
  /** Injectable for tests. Default: freshPushSchema over getDialectTables. */
  applyCore?: (
    dialect: FreshPushDialect,
    db: unknown
  ) => Promise<{ statementsExecuted: string[] }>;
  /**
   * Bootstrap the `nextly_schema_events` ledger (out-of-band, idempotent).
   * Called AFTER applyCore (so drizzle-kit pushSchema doesn't see the ledger
   * as an extraneous table) and BEFORE recording the core_apply event (so the
   * insert has a table to write to). The caller wires it to `getSchemaEventsDdl`
   * guarded by a table-exists check. Omitted in unit tests (the fixture
   * pre-creates the ledger).
   */
  ensureLedger?: () => Promise<void>;
}

export async function reconcileCore(
  deps: ReconcileCoreDeps
): Promise<{ changed: boolean }> {
  const { db, dialect, logger } = deps;
  const introspect = deps.introspect ?? introspectLiveSnapshot;
  const applyCore =
    deps.applyCore ??
    ((d: FreshPushDialect, database: unknown) =>
      freshPushSchema(d, database, getDialectTables(d)));

  const desired = getCoreSchema(dialect);
  const live = await introspect(db, dialect, [...CORE_TABLE_NAMES]);
  const ops = diffSnapshots(live, desired);

  if (ops.length === 0) {
    logger?.info?.("Core schema up to date.");
    return { changed: false };
  }

  const mode: ClassifierMode = deps.mode ?? "production-strict";
  // Always compute the destructive reasons via production-strict so both the
  // strict-refuse path and the non-strict confirmation path share one source.
  // Ask the data before judging DESTRUCTIVENESS only: requiring a column that
  // holds no NULL cannot fail on an existing row. Without this every SQLite
  // primary key reads as a pending NOT NULL addition and the whole reconcile
  // is refused on an untouched database. `ops` stays whole for the apply — a
  // safe op still has to be performed, or the constraint is never enforced.
  const opsForClassification = await resolveSafeNullabilityOps(db, ops);
  const strict = classifyForMode(
    opsForClassification,
    dialect,
    "production-strict"
  );
  const destructiveReasons = strict.verdict === "refuse" ? strict.reasons : [];

  if (destructiveReasons.length > 0) {
    if (mode === "production-strict") {
      if (!deps.allowDestructive) {
        throw new NextlyError({
          code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
          publicMessage:
            "Core schema reconciliation requires destructive operations: " +
            destructiveReasons.join("; ") +
            ". This usually means a Nextly version mismatch. Set " +
            "NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 to proceed (see release notes).",
        });
      }
      logger?.warn?.(
        "Applying destructive core change due to NEXTLY_ALLOW_CORE_DESTRUCTIVE=1."
      );
    } else {
      // dev-loose (and any future non-strict mode): require explicit operator
      // confirmation for the destructive set.
      const confirmed =
        (await deps.confirmDestructive?.(destructiveReasons)) ?? false;
      if (!confirmed) {
        throw new NextlyError({
          code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
          publicMessage:
            "Core schema reconciliation aborted: destructive operations were not confirmed: " +
            destructiveReasons.join("; ") +
            ".",
        });
      }
      logger?.warn?.(
        "Applying confirmed destructive core change (reconcile-core)."
      );
    }
  }

  const repo = new SchemaEventsRepository(db, dialect);
  try {
    // 1. Apply the core schema first (drizzle-kit pushSchema over
    //    getDialectTables). The ledger is NOT in that set, so pushSchema sees
    //    a clean diff (no extraneous-table prompt on a fresh DB).
    const result = await applyCore(dialect, db);

    // 2. Bootstrap the ledger out-of-band, after applyCore and before
    //    recording, so recordStart has a table to write to.
    await deps.ensureLedger?.();

    // 3. Record the core_apply event.
    const id = await repo.recordStart({
      eventType: "core_apply",
      source: "cli-migrate",
      scopeKind: "core",
    });
    await repo.markApplied(id, {
      statementsExecuted: result.statementsExecuted.length,
    });
    logger?.info?.(
      `Core schema reconciled (${result.statementsExecuted.length} statements).`
    );
    return { changed: true };
  } catch (err) {
    // applyCore/bootstrap may have failed before the ledger exists, so we
    // can't reliably record a failed event — surface the error instead.
    const message = err instanceof Error ? err.message : String(err);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: `Core schema apply failed: ${message}`,
    });
  }
}
