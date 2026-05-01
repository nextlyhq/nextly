// Plug-in interfaces for the F3 PushSchemaPipeline orchestrator.
// F3 ships no-op stubs implementing these (in pushschema-pipeline-stubs.ts);
// F4-F8 each replace one stub with a real implementation.
//
// Interface stability: once F4-F8 build on these signatures, changes
// become breaking. F3 locks them.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot, Operation } from "./diff/types";
import type {
  ClassificationResult,
  ClassifierEvent,
  Resolution,
} from "./resolution/types";

export interface RenameCandidate {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  fromType: string;
  toType: string;
  typesCompatible: boolean;
  defaultSuggestion: "rename" | "drop_and_add";
}

// F4 Option E: reads Operation[] (from our diff engine), identifies
// (drop_column, add_column) pairs that might be column renames, returns
// one RenameCandidate per pair grouped by table.
//
// The detector reads fromType from drop_column ops (which carry the
// previous column's type) and toType from add_column ops (which carry
// the new column's type). Type-family compatibility check decides
// `typesCompatible` and `defaultSuggestion`.
//
// Renamed from F4 PR 1's signature: previously took `statements: string[]`
// + `liveColumnTypes` because we parsed raw SQL strings from drizzle-kit's
// pushSchema output. Option E PR 1's diff engine produces structured
// operations with types embedded, so neither input is needed at this layer.
export interface RenameDetector {
  detect(operations: Operation[], dialect: SupportedDialect): RenameCandidate[];
}

export type ClassificationLevel = "safe" | "destructive" | "interactive";

// F5 + F6: classifies operations + drizzle-kit signals into events.
// Each event represents a user-visible decision point with applicable
// resolutions or a per-dialect warning. Reads typed Operation[] from F4
// Option E's diff stream (no regex parsing of drizzle-kit text output for
// nullability or type changes).
//
// countNulls/countRows are dependency-injected so the executor manages DB
// access; the classifier itself is pure logic plus per-dialect lookups.
export interface Classifier {
  classify(args: {
    operations: Operation[];
    drizzleWarnings: string[];
    hasDataLoss: boolean;
    countNulls: (table: string, column: string) => Promise<number>;
    countRows: (table: string) => Promise<number>;
    dialect: SupportedDialect;
  }): Promise<ClassificationResult>;
}

export interface PromptDispatchResult {
  confirmedRenames: RenameCandidate[];
  // Typed resolution payloads, one per ClassifierEvent the user resolved.
  // Empty array when classification is "safe" or no events were emitted.
  resolutions: Resolution[];
  // false when the user picks "abort" or closes the prompt; orchestrator
  // short-circuits the apply with PromptCancelledError in that case.
  proceed: boolean;
}

// F7/F8: routes prompts to the user (terminal via clack, browser via SSE-
// or pre-confirmation pattern from F4 PR 5) and waits for confirmation.
// Stub auto-confirms with proceed=true and empty arrays.
export interface PromptDispatcher {
  dispatch(args: {
    candidates: RenameCandidate[];
    events: ClassifierEvent[];
    classification: ClassificationLevel;
    channel: "browser" | "terminal";
  }): Promise<PromptDispatchResult>;
}

// F6: runs ALTER TABLE RENAME COLUMN per confirmed rename, inside the
// pipeline's transaction so it's atomic with the rest of the apply
// (on PG/SQLite — MySQL DDL is auto-commit either way).
export interface PreRenameExecutor {
  execute(tx: unknown, confirmed: RenameCandidate[]): Promise<void>;
}

// F5 PR 4: runs UPDATE / DELETE for confirmed F5 resolutions BEFORE pushSchema
// fires. For make_optional, returns a patched desired snapshot that keeps the
// affected column nullable (so pushSchema doesn't emit SET NOT NULL). For
// abort, throws PromptCancelledError so the pipeline short-circuits.
//
// The fields argument carries field-type metadata (name + type) so
// provide_default values can be Zod-validated against the column's type
// before the UPDATE fires.
export interface PreCleanupExecutor {
  execute(args: {
    tx: unknown;
    desiredSnapshot: NextlySchemaSnapshot;
    resolutions: Resolution[];
    events: ClassifierEvent[];
    fields: Array<{ name: string; type: string }>;
    dialect: SupportedDialect;
  }): Promise<NextlySchemaSnapshot>;
}

// F10 PR 2: scope of the apply, persisted into the journal so the admin
// NotificationCenter can render meaningful audit rows. Mirrors
// `MigrationJournalScopeKind` from `schemas/migration-journal/types.ts`.
export interface MigrationJournalScope {
  kind: "collection" | "single" | "global" | "fresh-push";
  slug?: string;
}

// F10 PR 2: per-change-kind counts derived from the pipeline's diff
// result. Persisted into the journal so audit rows can show
// "1 added, 1 renamed" instead of opaque statement counts.
export interface MigrationJournalSummary {
  added: number;
  removed: number;
  renamed: number;
  changed: number;
}

// F8: writes start/end records to the nextly_migration_journal table
// for observability + recovery. F10 PR 2 extends with optional scope +
// summary args so admin audit rows can render meaningful detail; older
// callers omitting the args remain compatible (legacy noop columns).
export interface MigrationJournal {
  recordStart(args: {
    source: "ui" | "code";
    statementsPlanned: number;
    scope?: MigrationJournalScope;
  }): Promise<string>;
  recordEnd(
    journalId: string,
    args: {
      success: boolean;
      statementsExecuted: number;
      error?: unknown;
      summary?: MigrationJournalSummary;
    }
  ): Promise<void>;
}

// Per-dialect statement execution. The pipeline owns pushSchema
// invocation; the executor just runs DDL inside the transaction.
// Implementation in services/drizzle-push-service.ts (refactored).
export interface DrizzleStatementExecutor {
  executeStatements(tx: unknown, statements: string[]): Promise<void>;
}

// F10 PR 3: re-export the Notifier interface so the pipeline's deps
// list can declare it without a deeper import path. Concrete
// implementations live under runtime/notifications/.
export type { Notifier } from "../../../runtime/notifications/types";

// Re-export resolution types so consumers can import everything from one place.
export type {
  ClassificationResult,
  ClassifierEvent,
  Resolution,
  ResolutionKind,
} from "./resolution/types";
