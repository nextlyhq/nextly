// Plug-in interfaces for the F3 PushSchemaPipeline orchestrator.
// F3 ships no-op stubs implementing these (in pushschema-pipeline-stubs.ts);
// F4-F8 each replace one stub with a real implementation.
//
// Interface stability: once F4-F8 build on these signatures, changes
// become breaking. F3 locks them.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

export interface RenameCandidate {
  tableName: string;
  fromColumn: string;
  toColumn: string;
  fromType: string;
  toType: string;
  typesCompatible: boolean;
  defaultSuggestion: "rename" | "drop_and_add";
}

// F4: parses drizzle-kit's statementsToExecute, identifies DROP+ADD pairs
// that might be column renames, returns one candidate per (drop, add) pair.
//
// `liveColumnTypes` is a Map<tableName, Map<columnName, type>> populated by
// the pipeline via queryLiveColumnTypes() before its first pushSchema call.
// The detector reads it to populate `RenameCandidate.fromType` and compute
// `typesCompatible`. A column missing from the map yields fromType: '' and
// typesCompatible: false (defensive - never silently claims compatibility).
export interface RenameDetector {
  detect(
    statements: string[],
    dialect: SupportedDialect,
    liveColumnTypes: Map<string, Map<string, string>>
  ): RenameCandidate[];
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
