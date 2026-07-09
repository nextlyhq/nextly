import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/**
 * A single localized column, described independently of the field system.
 * M3 will derive these from field descriptors; M1 accepts them directly so the
 * migration generator is self-contained and testable.
 */
export interface LocalizedColumnSpec {
  /** snake_case column name; identical on the main and companion tables. */
  name: string;
  /** logical storage kind — drives the per-dialect DDL type. */
  kind:
    | "text"
    | "longText"
    | "boolean"
    | "integer"
    | "double"
    | "timestamp"
    | "json"
    | "fkSingle";
  /** optional length for text/varchar-like columns. */
  length?: number;
}

/**
 * Everything the generator needs to emit an enable/disable localization migration for
 * one collection. Table names, default locale, and the columns to move are all explicit.
 */
export interface CompanionMigrationSpec {
  dialect: SupportedDialect;
  /** collection slug (for archive rows + file header). */
  collection: string;
  /** physical main table, e.g. "dc_pages". */
  mainTable: string;
  /** physical companion table, e.g. "dc_pages_locales". */
  companionTable: string;
  /** the default locale code seeded from existing rows, e.g. "en". */
  defaultLocale: string;
  /** DDL type of the main table's `id` column, so the companion FK type matches. */
  parentIdType: string;
  /** columns being localized (moved main -> companion). */
  columns: LocalizedColumnSpec[];
}
