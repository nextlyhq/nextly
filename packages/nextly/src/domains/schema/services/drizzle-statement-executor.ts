// F3: per-dialect statement execution layer extracted from
// DrizzlePushService. The PushSchemaPipeline owns pushSchema invocation;
// this class just runs DDL inside the transaction.
//
// Why a separate class: F3's pipeline needs to receive the SQL statements
// (so RenameDetector / Classifier / PromptDispatcher can intercept them)
// and then execute them itself. The old DrizzlePushService.apply() did
// both push AND execute together — incompatible with interception.
//
// Dialect notes (drizzle-kit v1):
//   - SQLite: v1's recreate-table flow emits its PRAGMA foreign_keys
//     OFF/ON choreography INSIDE the statement stream and its rebuild
//     INSERT..SELECT lists only pre-existing columns — the pre-v1
//     missing-column NULL-rewrite is gone. The pipeline still toggles
//     the pragma outside any transaction (see PR-4 rationale below);
//     passing v1's inline pragmas through is harmless and correct.
//   - MySQL: statements from pushSchema are executed straight; MySQL
//     DDL auto-commits regardless of the transaction wrapper.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { DrizzleStatementExecutor as DrizzleStatementExecutorInterface } from "../pipeline/pushschema-pipeline-interfaces";
import {
  isIdempotencyError,
  splitStatements,
} from "../pipeline/sql-statement-utils";

// Minimal duck-typed shapes for the per-dialect db / tx clients.
// Avoids `as any` casts at every call site by narrowing to what we
// actually invoke.
interface AsyncExecuteClient {
  execute(query: unknown): Promise<unknown>;
}

interface SqliteSyncRunClient {
  run(query: unknown): unknown;
  all(query: unknown): unknown;
}

export class DrizzleStatementExecutor
  implements DrizzleStatementExecutorInterface
{
  constructor(
    private dialect: SupportedDialect,
    private db: unknown
  ) {}

  // tx is load-bearing for PG and MySQL (we execute via tx.execute so
  // the statements run inside the pipeline's transaction). For SQLite,
  // tx is intentionally ignored — better-sqlite3's driver is sync and
  // automatically associates this.db.run() calls with the active
  // transaction context (started by drizzle's db.transaction()).
  async executeStatements(tx: unknown, statements: string[]): Promise<void> {
    if (statements.length === 0) return;
    switch (this.dialect) {
      case "postgresql":
        return this.executePg(tx, statements);
      case "mysql":
        return this.executeMysql(tx, statements);
      case "sqlite":
        return this.executeSqlite(statements);
      default: {
        const exhaustive: never = this.dialect;
        throw new Error(`Unsupported dialect: ${String(exhaustive)}`);
      }
    }
  }

  private async executePg(tx: unknown, statements: string[]): Promise<void> {
    const { sql: sqlTag } = await import("drizzle-orm");
    const txTyped = tx as AsyncExecuteClient;
    for (const stmt of statements) {
      await txTyped.execute(sqlTag.raw(stmt));
    }
  }

  private async executeMysql(tx: unknown, statements: string[]): Promise<void> {
    const { sql: sqlTag } = await import("drizzle-orm");
    const txTyped = tx as AsyncExecuteClient;
    for (const stmt of statements) {
      await txTyped.execute(sqlTag.raw(stmt));
    }
    // Note: drizzle-kit 0.31.10's silent-drop bug for MySQL applies to
    // pushSchema's apply() method, NOT to manual statement execution.
    // The pipeline owns pushSchema invocation and passes us the
    // kit statements array directly (which IS correct), so we can
    // execute them straight. No applyViaGenerate workaround at this layer.
    //
    // MySQL DDL is auto-committed regardless of the BEGIN/COMMIT wrapper
    // around this call. F15 will add pre-flight validation to catch
    // conflicts before any ALTER runs.
  }

  private async executeSqlite(statements: string[]): Promise<void> {
    const { sql: sqlTag } = await import("drizzle-orm");
    // SQLite's better-sqlite3 driver is synchronous; we call this.db
    // directly rather than through the async tx handle. better-sqlite3
    // wraps statements in the active transaction context automatically.
    const dbTyped = this.db as SqliteSyncRunClient;

    // PRAGMA foreign_keys = OFF/ON wrapping for the recreate-table pattern,
    // and the `PRAGMA foreign_key_check` that refuses dangling references,
    // belong to the whole apply rather than to one batch of it: the
    // pipeline runs every SQLite apply under the shared schema-change
    // contract (`migrate/sqlite-foreign-keys.ts`), checking once after the
    // last statement. SQLite silently no-ops PRAGMA foreign_keys changes
    // INSIDE a transaction, so this executor could not toggle it anyway.
    //
    // Splitting and idempotency tolerance are single-sourced in
    // sql-statement-utils.ts — this executor and fresh-push previously
    // carried drifting private copies of both.
    for (const stmt of splitStatements(statements)) {
      try {
        dbTyped.run(sqlTag.raw(stmt));
      } catch (err) {
        if (isIdempotencyError(err)) continue;
        throw err;
      }
    }
  }
}
