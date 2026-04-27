// F3: per-dialect statement execution layer extracted from
// DrizzlePushService. The PushSchemaPipeline owns pushSchema invocation;
// this class just runs DDL inside the transaction.
//
// Why a separate class: F3's pipeline needs to receive the SQL statements
// (so RenameDetector / Classifier / PromptDispatcher can intercept them)
// and then execute them itself. The old DrizzlePushService.apply() did
// both push AND execute together — incompatible with interception.
//
// Dialect-specific behavior preserved verbatim from the old service:
//   - SQLite: rewriteRecreateInsertForMissingCols handles drizzle-kit's
//     recreate-table pattern where some columns don't yet exist on the
//     source table. PR-4 layers PRAGMA foreign_keys = OFF / ON wrapping
//     on top of this.
//   - MySQL: no workaround needed at this layer. drizzle-kit 0.31.10's
//     silent-drop bug only affected its apply() method; we get the
//     correct statementsToExecute from pushSchema directly and run
//     them straight.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { DrizzleStatementExecutor as DrizzleStatementExecutorInterface } from "../pipeline/pushschema-pipeline-interfaces.js";

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
    // statementsToExecute array directly (which IS correct), so we can
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
    //
    // PR-4 will add PRAGMA foreign_keys = OFF / foreign_key_check / ON
    // wrapping around this loop.
    const dbTyped = this.db as SqliteSyncRunClient;
    for (const rawStmt of statements) {
      const pieces = rawStmt
        .split("\n")
        .map((line: string) => line.replace(/--> statement-breakpoint/g, ""))
        .join("\n")
        .split(";")
        .map((s: string) => s.trim())
        .filter(
          (s: string) =>
            s.length > 0 &&
            !s.startsWith("--") &&
            /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(s)
        );
      for (const raw of pieces) {
        const stmt = await this.rewriteRecreateInsertForMissingCols(raw);
        try {
          dbTyped.run(sqlTag.raw(stmt));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate column name")
          ) {
            continue;
          }
          throw err;
        }
      }
    }
  }

  // Preserved verbatim (with structural typing) from the old
  // DrizzlePushService — see that class for the original rationale.
  // Drizzle-kit 0.31.10's SQLite recreate-table strategy emits
  //   INSERT INTO `__new_<t>`(cols) SELECT cols FROM `<t>`
  // where `cols` includes columns that do not yet exist in `<t>`.
  // That fails with "no such column". This rewrites the SELECT list
  // so missing columns are substituted with NULL.
  private async rewriteRecreateInsertForMissingCols(
    stmt: string
  ): Promise<string> {
    const m = stmt.match(
      /^INSERT\s+INTO\s+`(__new_[^`]+)`\s*\(([^)]+)\)\s+SELECT\s+([^]+?)\s+FROM\s+`([^`]+)`\s*$/i
    );
    if (!m) return stmt;
    const [, , insertColsRaw, , sourceTable] = m;
    if (/["\0]/.test(sourceTable)) return stmt;
    const insertCols = insertColsRaw
      .split(",")
      .map(c => c.trim().replace(/^`|`$/g, "").replace(/^"|"$/g, ""));
    let sourceColNames: string[];
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      const dbTyped = this.db as SqliteSyncRunClient;
      const rows = dbTyped.all(
        sqlTag.raw(`PRAGMA table_info("${sourceTable}")`)
      ) as Array<{ name: string }>;
      sourceColNames = rows.map(r => r.name);
    } catch {
      return stmt;
    }
    const selectList = insertCols
      .map(col => (sourceColNames.includes(col) ? `"${col}"` : "NULL"))
      .join(", ");
    const colList = insertCols.map(col => `"${col}"`).join(", ");
    return `INSERT INTO \`__new_${sourceTable}\`(${colList}) SELECT ${selectList} FROM \`${sourceTable}\``;
  }
}
