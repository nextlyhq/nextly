// Plug-in interfaces for the F3 PushSchemaPipeline orchestrator.
// F3 ships no-op stubs implementing these (in pushschema-pipeline-stubs.ts);
// F4-F8 each replace one stub with a real implementation.
//
// Interface stability: once F4-F8 build on these signatures, changes
// become breaking. F3 locks them.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { Operation } from "./diff/types.js";

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

// F5: classifies the overall apply by examining drizzle-kit's warnings
// + hasDataLoss flag. Determines whether we need to prompt the user.
export interface Classifier {
  classify(warnings: string[], hasDataLoss: boolean): ClassificationLevel;
}

export interface PromptDispatchResult {
  confirmedRenames: RenameCandidate[];
  resolutions: Record<string, unknown>;
}

// F7/F8: routes prompts to the user (terminal via clack, browser via SSE)
// and waits for confirmation. Stub auto-confirms (returns empty).
export interface PromptDispatcher {
  dispatch(args: {
    candidates: RenameCandidate[];
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

// F8: writes start/end records to the dynamic_migrations table for
// observability + recovery. Stub returns dummy IDs and writes nothing.
export interface MigrationJournal {
  recordStart(args: {
    source: "ui" | "code";
    statementsPlanned: number;
  }): Promise<string>;
  recordEnd(
    journalId: string,
    args: { success: boolean; statementsExecuted: number; error?: unknown }
  ): Promise<void>;
}

// Per-dialect statement execution. The pipeline owns pushSchema
// invocation; the executor just runs DDL inside the transaction.
// Implementation in services/drizzle-push-service.ts (refactored).
export interface DrizzleStatementExecutor {
  executeStatements(tx: unknown, statements: string[]): Promise<void>;
}
