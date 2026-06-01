// Drizzle-backed implementation of the pipeline's MigrationJournal
// interface. Plan C1: records every pipeline apply (success/failure) into
// the consolidated `nextly_schema_events` table via SchemaEventsRepository,
// replacing the legacy `nextly_migration_journal` table.
//
// The MigrationJournal interface and this class's `{ db, dialect, logger }`
// constructor are UNCHANGED — only the backing store moved. Callers (DI
// registration, dev-server db-sync, the HMR pipeline) need no edits.
//
// Failure mode: the journal is "best-effort" — a write that fails must NOT
// break the schema apply. Errors are logged via the injected logger and the
// surrounding pipeline call continues.

import { SchemaEventsRepository } from "../events/schema-events-repository";
import type {
  SchemaEventScopeKind,
  SchemaEventSource,
  SchemaEventType,
} from "../../../schemas/schema-events/types";
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

// Sentinel prefix returned from recordStart when the initial insert fails.
// recordEnd skips the update when it sees this prefix.
const FAILED_INSERT_PREFIX = "journal-failed-";

const ERROR_MESSAGE_MAX_LEN = 1000;

// Safe stringification for the recorded error column. Avoids
// "[object Object]" output (lint rule no-base-to-string flags raw String()).
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

// Map the journal's binary `source` to the events table's richer
// (event_type, source) pair (spec §4.3).
function mapSourceToEvent(source: "ui" | "code"): {
  eventType: SchemaEventType;
  source: SchemaEventSource;
} {
  return source === "ui"
    ? { eventType: "ui_save", source: "admin-ui" }
    : { eventType: "dev_push", source: "dev-server" };
}

// The events table has no "fresh-push" scope; fold it into "global".
function mapScopeKind(kind: MigrationJournalScope["kind"]): SchemaEventScopeKind {
  return kind === "fresh-push" ? "global" : kind;
}

export class DrizzleMigrationJournal implements MigrationJournal {
  private readonly repo: SchemaEventsRepository;
  private readonly logger: LoggerLike;

  // Per-row start time, kept in-memory between recordStart and recordEnd so
  // we can compute duration_ms without a SELECT round-trip. If the process
  // restarts mid-apply, the row stays at status='in_progress' (admin tooling
  // can find these via the started_at index).
  private readonly startTimes = new Map<string, number>();

  constructor(deps: DrizzleMigrationJournalDeps) {
    this.repo = new SchemaEventsRepository(deps.db, deps.dialect);
    this.logger = deps.logger;
  }

  async recordStart(args: {
    source: "ui" | "code";
    statementsPlanned: number;
    scope?: MigrationJournalScope;
    batch?: number;
  }): Promise<string> {
    const { eventType, source } = mapSourceToEvent(args.source);
    try {
      const id = await this.repo.recordStart({
        eventType,
        source,
        scopeKind: args.scope ? mapScopeKind(args.scope.kind) : undefined,
        scopeSlug: args.scope?.slug,
      });
      this.startTimes.set(id, Date.now());
      return id;
    } catch (err) {
      this.logger.warn?.(
        `[MigrationJournal] recordStart failed (${stringifyError(err)}). ` +
          "Pipeline will continue without a journal entry."
      );
      return `${FAILED_INSERT_PREFIX}${Date.now()}`;
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

    const startMs = this.startTimes.get(journalId);
    const durationMs =
      startMs !== undefined ? Math.max(0, Date.now() - startMs) : undefined;
    this.startTimes.delete(journalId);

    try {
      if (args.success) {
        await this.repo.markApplied(journalId, {
          statementsExecuted: args.statementsExecuted,
          renamesApplied: args.summary?.renamed,
          durationMs,
        });
      } else {
        const raw = stringifyError(args.error);
        const errorMessage =
          raw.length > ERROR_MESSAGE_MAX_LEN
            ? `${raw.slice(0, ERROR_MESSAGE_MAX_LEN)}...`
            : raw;
        await this.repo.markFailed(journalId, {
          errorMessage,
          errorJson:
            args.error instanceof Error
              ? {
                  name: args.error.name,
                  message: args.error.message,
                  stack: args.error.stack,
                }
              : args.error,
        });
      }
    } catch (err) {
      this.logger.warn?.(
        `[MigrationJournal] recordEnd failed for '${journalId}' (${stringifyError(err)}). ` +
          "Pipeline result unaffected."
      );
    }
  }
}
