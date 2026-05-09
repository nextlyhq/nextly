// Database types used by transaction hooks and services.
// These were previously in database/adapters/base.ts (deprecated).
// Inlined here to remove the dependency on the old adapter system.

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

export interface TransactionHooksContext {
  dialect: SupportedDialect;
  attempt: number; // 1-based
  options?: { isolationLevel?: string } | undefined;
}

export interface TransactionResult {
  attempts: number;
  durationMs: number;
  committed: boolean;
  dialect: SupportedDialect;
  errorCode?: string;
  errorKind?: string;
}

export interface TransactionHooks {
  beforeTransaction?: (ctx: TransactionHooksContext) => Promise<void> | void;
  afterTransaction?: (
    ctx: TransactionHooksContext & { result: TransactionResult }
  ) => Promise<void> | void;
}
