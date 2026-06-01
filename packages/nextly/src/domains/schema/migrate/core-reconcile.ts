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
import { classifyForMode } from "../pipeline/classifier/modes";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { freshPushSchema, type FreshPushDialect } from "../pipeline/fresh-push";

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

  const verdict = classifyForMode(ops, dialect, "production-strict");
  if (verdict.verdict === "refuse") {
    if (!deps.allowDestructive) {
      throw new NextlyError({
        code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
        publicMessage:
          "Core schema reconciliation requires destructive operations: " +
          verdict.reasons.join("; ") +
          ". This usually means a Nextly version mismatch. Set " +
          "NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 to proceed (see release notes).",
      });
    }
    logger?.warn?.(
      "Applying destructive core change due to NEXTLY_ALLOW_CORE_DESTRUCTIVE=1."
    );
  }

  const repo = new SchemaEventsRepository(db, dialect);
  const id = await repo.recordStart({
    eventType: "core_apply",
    source: "cli-migrate",
    scopeKind: "core",
  });
  try {
    const result = await applyCore(dialect, db);
    await repo.markApplied(id, {
      statementsExecuted: result.statementsExecuted.length,
    });
    logger?.info?.(
      `Core schema reconciled (${result.statementsExecuted.length} statements).`
    );
    return { changed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repo.markFailed(id, {
      errorMessage: message,
      errorJson:
        err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: `Core schema apply failed: ${message}`,
    });
  }
}
