// Drizzle-backed implementation of the pipeline's MigrationJournal
// interface. Records every pipeline apply (success/failure/abort)
// into the `nextly_migration_journal` table for audit + observability.
//
// F8 PR 5 ships this MVP. Future extensions (richer fields like
// requestId / actor / slugs / renamesApplied) will extend the
// `MigrationJournal` interface in pushschema-pipeline-interfaces.ts
// and update the table + this implementation in lockstep.
//
// Failure mode: the journal is "best-effort" — a journal write that
// fails (DB connection lost, table missing, etc.) must NOT break the
// schema apply. Errors are logged via the injected logger and the
// surrounding pipeline call continues.

import { eq } from "drizzle-orm";

import {
  nextlyMigrationJournalMysql,
  nextlyMigrationJournalPg,
  nextlyMigrationJournalSqlite,
} from "../../../schemas/migration-journal/index";
import type {
  MigrationJournal,
  MigrationJournalScope,
  MigrationJournalSummary,
} from "../pipeline/pushschema-pipeline-interfaces";

type Dialect = "postgresql" | "mysql" | "sqlite";

interface LoggerLike {
  debug?: (msg: string) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface DrizzleMigrationJournalDeps {
  // Drizzle DB instance for the configured dialect. Typed as `unknown`
  // because the journal lives in the schema-domain layer and we don't
  // want to leak the dialect-specific Drizzle types upward.
  db: unknown;
  dialect: Dialect;
  logger: LoggerLike;
}

// Sentinel prefix returned from recordStart when the initial insert
// fails (DB unreachable, table missing pre-ensureCoreTables, etc.).
// recordEnd skips the update when it sees this prefix so we don't
// generate orphan UPDATE WHERE id=...-not-found queries.
const FAILED_INSERT_PREFIX = "journal-failed-";

const ERROR_MESSAGE_MAX_LEN = 1000;

// Safe stringification for the recorded error column. Avoids
// "[object Object]" output when callers pass a plain object (lint
// rule no-base-to-string flags raw `String(obj)`).
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return String(err);
  if (err === null) return "null";
  try {
    return JSON.stringify(err);
  } catch {
    return "[unstringifiable error]";
  }
}

export class DrizzleMigrationJournal implements MigrationJournal {
  private readonly db: unknown;
  private readonly dialect: Dialect;
  private readonly logger: LoggerLike;

  // Per-row start time. Stored in-memory between recordStart and
  // recordEnd so we can compute duration_ms without a SELECT round-trip.
  // Keyed by the journal row's id (UUID). If the process restarts
  // mid-apply, the row stays at status='in_progress' indefinitely
  // (admin tooling can find these via the status index).
  private readonly startTimes = new Map<string, number>();

  constructor(deps: DrizzleMigrationJournalDeps) {
    this.db = deps.db;
    this.dialect = deps.dialect;
    this.logger = deps.logger;
  }

  async recordStart(args: {
    source: "ui" | "code";
    statementsPlanned: number;
    scope?: MigrationJournalScope;
  }): Promise<string> {
    // Wrapped in try/catch: crypto.randomUUID() is sync and only throws
    // if the runtime lacks a CSPRNG (extremely rare TypeError on niche
    // VMs). Keep the journal failure-safe contract — return a sentinel
    // and let the pipeline continue.
    let id: string;
    try {
      id = crypto.randomUUID();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(
        `[MigrationJournal] crypto.randomUUID() unavailable (${msg}). Skipping journal entry.`
      );
      return `${FAILED_INSERT_PREFIX}no-uuid`;
    }
    const startedAt = new Date();
    const startMs = Date.now();

    const table = this.tableForDialect();

    try {
      // Drizzle's typed insert builder is dialect-specific; we accept
      // a structural shape on the journal's `db` dep and trust the
      // caller wired the right Drizzle instance.
      const inserter = (
        this.db as {
          insert: (t: unknown) => {
            values: (v: Record<string, unknown>) => Promise<unknown>;
          };
        }
      ).insert(table);

      // F10 PR 2: include the new nullable scope columns when callers
      // pass scope info. Legacy callers (no scope arg) skip the
      // properties so the DB stores NULL.
      const insertValues: Record<string, unknown> = {
        id,
        source: args.source,
        status: "in_progress",
        startedAt,
        statementsPlanned: args.statementsPlanned,
      };
      if (args.scope) {
        insertValues.scopeKind = args.scope.kind;
        if (args.scope.slug !== undefined) {
          insertValues.scopeSlug = args.scope.slug;
        }
      }

      await inserter.values(insertValues);
      this.startTimes.set(id, startMs);
      return id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(
        `[MigrationJournal] recordStart failed (${msg}). Pipeline will continue without journal entry.`
      );
      // Return a sentinel so recordEnd can skip the update cleanly.
      return `${FAILED_INSERT_PREFIX}${id}`;
    }
  }

  async recordEnd(
    journalId: string,
    args: {
      success: boolean;
      statementsExecuted: number;
      error?: unknown;
      summary?: MigrationJournalSummary;
    }
  ): Promise<void> {
    if (journalId.startsWith(FAILED_INSERT_PREFIX)) {
      // recordStart's insert failed; nothing to update.
      return;
    }

    const endedAt = new Date();
    const endMs = endedAt.getTime();
    const startMs = this.startTimes.get(journalId);
    const durationMs =
      startMs !== undefined ? Math.max(0, endMs - startMs) : null;
    this.startTimes.delete(journalId);

    const status: "success" | "failed" = args.success ? "success" : "failed";

    // Truncation policy: messages STRICTLY longer than ERROR_MESSAGE_MAX_LEN
    // are clipped to that length and suffixed with "..." (so the column
    // can hold up to ERROR_MESSAGE_MAX_LEN + 3 chars). Messages exactly
    // ERROR_MESSAGE_MAX_LEN chars long pass through unchanged.
    let errorMessage: string | null = null;
    if (!args.success && args.error !== undefined) {
      const raw = stringifyError(args.error);
      errorMessage =
        raw.length > ERROR_MESSAGE_MAX_LEN
          ? `${raw.slice(0, ERROR_MESSAGE_MAX_LEN)}...`
          : raw;
    }

    const table = this.tableForDialect();
    const idColumn = (table as { id: unknown }).id;

    try {
      const updater = (
        this.db as {
          update: (t: unknown) => {
            set: (v: Record<string, unknown>) => {
              where: (clause: unknown) => Promise<unknown>;
            };
          };
        }
      ).update(table);

      // F10 PR 2: include summary columns when callers pass them.
      // Legacy callers (no summary arg) skip the properties so the DB
      // stores NULL — column nullability is the forward-compat contract.
      const setValues: Record<string, unknown> = {
        status,
        endedAt,
        durationMs,
        statementsExecuted: args.statementsExecuted,
        errorMessage,
      };
      if (args.summary) {
        setValues.summaryAdded = args.summary.added;
        setValues.summaryRemoved = args.summary.removed;
        setValues.summaryRenamed = args.summary.renamed;
        setValues.summaryChanged = args.summary.changed;
      }

      await updater
        .set(setValues)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type is dialect-specific; structural ID match
        .where(eq(idColumn as any, journalId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(
        `[MigrationJournal] recordEnd failed for journal '${journalId}' (${msg}). Pipeline result unaffected.`
      );
    }
  }

  private tableForDialect(): unknown {
    switch (this.dialect) {
      case "postgresql":
        return nextlyMigrationJournalPg;
      case "mysql":
        return nextlyMigrationJournalMysql;
      case "sqlite":
        return nextlyMigrationJournalSqlite;
      default: {
        const exhaustive: never = this.dialect;
        throw new Error(`Unsupported dialect: ${String(exhaustive)}`);
      }
    }
  }
}
