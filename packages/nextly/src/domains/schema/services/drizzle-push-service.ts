// Wraps drizzle-kit/api pushSchema() with preview/apply flow.
// Replaces raw SQL DDL generation in SchemaPushService.
// Supports all three dialects via the drizzle-kit-api wrapper.

import {
  requireDrizzleKit,
  requireDrizzleKitMySQL,
  requireDrizzleKitSQLite,
  type PushSchemaResult,
} from "../../../database/drizzle-kit-api";

export type SupportedDialect = "postgresql" | "mysql" | "sqlite";

// Result of a preview or apply operation
export interface PushPreviewResult {
  hasDataLoss: boolean;
  warnings: string[];
  statementsToExecute: string[];
  applied: boolean;
}

// Options for previewAndApply
export interface PushApplyOptions {
  dryRun?: boolean;
  schemaFilters?: string[]; // PostgreSQL schema filters (default: ["public"])
}

export class DrizzlePushService {
  private dialect: SupportedDialect;
  private db: unknown;
  private databaseName?: string;

  constructor(dialect: SupportedDialect, db: unknown, databaseName?: string) {
    this.dialect = dialect;
    this.db = db;
    // MySQL's pushSchema needs the database name to know which schema to
    // introspect. Without it, drizzle-kit compares against no tables, finds
    // "nothing to do", and returns zero DDL statements — silently creating
    // no tables. If the caller doesn't pass a name explicitly, try to
    // extract it from DATABASE_URL.
    this.databaseName =
      databaseName ?? this.extractDatabaseNameFromUrl(process.env.DATABASE_URL);
  }

  // Extract the database name from a MySQL URL like
  // "mysql://user:pass@host:port/dbname". Returns undefined for non-MySQL
  // URLs or when no database segment is present.
  private extractDatabaseNameFromUrl(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      const normalized = url.replace(/^mysql:\/\//, "http://");
      const parsed = new URL(normalized);
      const pathname = parsed.pathname;
      return pathname && pathname.length > 1 ? pathname.slice(1) : undefined;
    } catch {
      return undefined;
    }
  }

  // Preview schema changes without applying (dry-run).
  // Returns what would change but does not call apply().
  async preview(schema: Record<string, unknown>): Promise<PushPreviewResult> {
    const result = await this.callPushSchema(schema);
    return {
      hasDataLoss: result.hasDataLoss,
      warnings: result.warnings,
      statementsToExecute: result.statementsToExecute,
      applied: false,
    };
  }

  // Apply schema changes immediately.
  // For PG: calls pushSchema() and then apply().
  // For SQLite: calls pushSchema() to get statements diffed against the live
  //   DB (proper ALTER TABLE ADD COLUMN etc.), then executes them with .run()
  //   because drizzle-kit 0.31.10's apply() uses .all() for DDL which
  //   fails on statements that do not return rows.
  // For MySQL: uses the generateDrizzleJson + generateMigration workaround
  //   because drizzle-kit 0.31.10's logSuggestionsAndReturn silently drops
  //   non-destructive DDL on the apply path.
  async apply(schema: Record<string, unknown>): Promise<PushPreviewResult> {
    if (this.dialect === "mysql") {
      return this.applyViaGenerate(schema, "mysql");
    }
    if (this.dialect === "sqlite") {
      return this.applyViaPushSchemaSQLite(schema);
    }

    // PostgreSQL: pushSchema works correctly — use it directly.
    const result = await this.callPushSchema(schema);
    await result.apply();
    return {
      hasDataLoss: result.hasDataLoss,
      warnings: result.warnings,
      statementsToExecute: result.statementsToExecute,
      applied: true,
    };
  }

  // SQLite apply path that uses pushSchema() to get statements diffed
  // against the LIVE database, then executes them with .run() ourselves.
  // Why: drizzle-kit 0.31.10's returned apply() uses .all() for DDL which
  // fails on statements that do not return rows. The statementsToExecute
  // array, however, is correct and reflects the real ALTER TABLE / ADD
  // COLUMN needed for existing tables. The earlier approach of diffing
  // against an empty {} snapshot produced CREATE TABLE statements only,
  // so column additions against existing tables became no-ops under
  // `CREATE TABLE IF NOT EXISTS` rewriting.
  private async applyViaPushSchemaSQLite(
    schema: Record<string, unknown>
  ): Promise<PushPreviewResult> {
    const kit = requireDrizzleKitSQLite();
    const result = await kit.pushSchema(schema, this.db);

    if (
      !result.statementsToExecute ||
      result.statementsToExecute.length === 0
    ) {
      return {
        hasDataLoss: result.hasDataLoss ?? false,
        warnings: result.warnings ?? [],
        statementsToExecute: [],
        applied: true,
      };
    }

    const { sql: sqlTag } = await import("drizzle-orm");
    const executed: string[] = [];
    for (const rawStmt of result.statementsToExecute) {
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
        // Drizzle-kit 0.31.10's SQLite recreate-table strategy emits
        //   INSERT INTO `__new_<t>`(cols) SELECT cols FROM `<t>`
        // where `cols` includes columns that do not yet exist in `<t>`.
        // That fails with "no such column". Rewrite the SELECT list so
        // columns missing from the live source are substituted with NULL.
        const stmt = await this.rewriteRecreateInsertForMissingCols(raw);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.db as any).run(sqlTag.raw(stmt));
          executed.push(stmt);
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

    return {
      hasDataLoss: result.hasDataLoss ?? false,
      warnings: result.warnings ?? [],
      statementsToExecute: executed,
      applied: true,
    };
  }

  // Rewrites a SQLite recreate-table INSERT to substitute NULL for any
  // column that does not exist in the source table. Returns the input
  // unchanged if it is not an INSERT of the recreate form.
  // Shape recognised:
  //   INSERT INTO `__new_<t>`("a","b",...) SELECT "a","b",... FROM `<t>`
  private async rewriteRecreateInsertForMissingCols(
    stmt: string
  ): Promise<string> {
    const m = stmt.match(
      /^INSERT\s+INTO\s+`(__new_[^`]+)`\s*\(([^)]+)\)\s+SELECT\s+([^]+?)\s+FROM\s+`([^`]+)`\s*$/i
    );
    if (!m) return stmt;
    const [, , insertColsRaw, , sourceTable] = m;
    // Defence-in-depth: the capture matched `[^`]+` so it cannot contain a
    // backtick, but `"` and NUL would still break the PRAGMA quoting below.
    // drizzle-kit only emits `dc_<slug>` style names in practice - bail out
    // if the identifier violates our assumptions rather than risk injection.
    if (/["\0]/.test(sourceTable)) return stmt;
    const insertCols = insertColsRaw
      .split(",")
      .map(c => c.trim().replace(/^`|`$/g, "").replace(/^"|"$/g, ""));
    let sourceColNames: string[];
    try {
      const { sql: sqlTag } = await import("drizzle-orm");
      // PRAGMA returns rows with {cid,name,type,notnull,dflt_value,pk}.
      // Identifier is whatever drizzle-kit emitted, validated above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (this.db as any).all(
        sqlTag.raw(`PRAGMA table_info("${sourceTable}")`)
      ) as Array<{ name: string }>;
      sourceColNames = rows.map(r => r.name);
    } catch {
      // If the live pragma fails, leave the statement unchanged so the
      // original error surfaces rather than a misleading rewrite.
      return stmt;
    }
    const selectList = insertCols
      .map(col => (sourceColNames.includes(col) ? `"${col}"` : "NULL"))
      .join(", ");
    const colList = insertCols.map(col => `"${col}"`).join(", ");
    return `INSERT INTO \`__new_${sourceTable}\`(${colList}) SELECT ${selectList} FROM \`${sourceTable}\``;
  }

  // Dialect-agnostic apply path that bypasses the broken pushSchema().
  // Generates a Drizzle JSON snapshot of the desired schema, diffs it
  // against an empty snapshot, and executes the resulting DDL SQL.
  private async applyViaGenerate(
    schema: Record<string, unknown>,
    dialect: "mysql" | "sqlite"
  ): Promise<PushPreviewResult> {
    const kit =
      dialect === "mysql"
        ? requireDrizzleKitMySQL()
        : requireDrizzleKitSQLite();

    const curJson = await kit.generateDrizzleJson(schema);
    const prevJson = await kit.generateDrizzleJson({});

    const sqlStatements = await kit.generateMigration(prevJson, curJson);

    if (!sqlStatements || sqlStatements.length === 0) {
      return {
        hasDataLoss: false,
        warnings: [],
        statementsToExecute: [],
        applied: true,
      };
    }

    const db = this.db as { execute: (sql: unknown) => Promise<unknown> };
    const executedStatements: string[] = [];

    for (const migrationSql of sqlStatements) {
      const individualStatements = migrationSql
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

      for (let stmt of individualStatements) {
        try {
          stmt = stmt.replace(
            /\bCREATE TABLE\b(?!\s+IF\s+NOT\s+EXISTS)/gi,
            "CREATE TABLE IF NOT EXISTS"
          );

          const { sql: sqlTag } = await import("drizzle-orm");
          if (dialect === "sqlite") {
            (this.db as any).run(sqlTag.raw(stmt));
          } else {
            await (this.db as any).execute(sqlTag.raw(stmt));
          }
          executedStatements.push(stmt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("already exists") || msg.includes("Duplicate")) {
            continue;
          }
          throw err;
        }
      }
    }

    return {
      hasDataLoss: false,
      warnings: [],
      statementsToExecute: executedStatements,
      applied: true,
    };
  }

  // Preview then optionally apply based on dryRun flag.
  // Default behavior (no options): applies changes.
  async previewAndApply(
    schema: Record<string, unknown>,
    options: PushApplyOptions = {}
  ): Promise<PushPreviewResult> {
    const result = await this.callPushSchema(schema);

    if (!options.dryRun) {
      await result.apply();
    }

    return {
      hasDataLoss: result.hasDataLoss,
      warnings: result.warnings,
      statementsToExecute: result.statementsToExecute,
      applied: !options.dryRun,
    };
  }

  // Dispatch to the correct dialect-specific pushSchema function
  private async callPushSchema(
    schema: Record<string, unknown>
  ): Promise<PushSchemaResult> {
    switch (this.dialect) {
      case "postgresql": {
        const kit = requireDrizzleKit();
        return kit.pushSchema(schema, this.db, ["public"]);
      }
      case "mysql": {
        const kit = requireDrizzleKitMySQL();
        // MySQL pushSchema requires the database name as the 3rd parameter
        // so drizzle-kit knows which schema to introspect for diff comparison.
        // Without it, it finds zero existing tables and returns zero DDL.
        return kit.pushSchema(schema, this.db, this.databaseName ?? "");
      }
      case "sqlite": {
        const kit = requireDrizzleKitSQLite();
        return kit.pushSchema(schema, this.db);
      }
      default:
        throw new Error(`Unsupported dialect: ${this.dialect}`);
    }
  }
}
