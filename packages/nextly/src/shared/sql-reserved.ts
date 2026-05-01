/**
 * Shared SQL Reserved Keyword & Slug Constants
 *
 * Pure-data module — no imports — so it can be the cycle-breaker between
 * collections/config/validate-config.ts and shared/base-validator.ts.
 *
 * Originally these constants lived in validate-config.ts and base-validator.ts
 * imported them back, creating a circular dependency. tsup's bundling masked
 * the issue (its evaluation order happened to initialise the constants before
 * base-validator's top-level Set construction). Turbopack's strict ESM
 * evaluation surfaced it as a TDZ ReferenceError when source-mode dev started
 * walking the source files directly.
 *
 * Solution: extract the constants here. Both validate-config and base-validator
 * import from this leaf module, which has no further imports → no cycle.
 *
 * @module shared/sql-reserved
 */

// ============================================================
// Reserved Names and Keywords
// ============================================================

/**
 * Reserved collection slugs that cannot be used.
 * These are used by the system or have special meaning.
 */
export const RESERVED_SLUGS = [
  // API routes
  "api",
  "graphql",
  "rest",
  // Admin routes
  "admin",
  "dashboard",
  // Auth routes
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "signout",
  "forgot-password",
  "reset-password",
  "verify",
  "verify-email",
  // System routes
  "static",
  "public",
  "assets",
  "_next",
  "health",
  "status",
  "metrics",
  // Common system collections
  "users",
  "roles",
  "permissions",
  "sessions",
  "tokens",
  "media",
  "uploads",
  "files",
] as const;

/**
 * SQL reserved keywords that should not be used as identifiers.
 *
 * Curated list of the most problematic keywords across PostgreSQL, MySQL,
 * and SQLite. Using these as table or column names can cause issues even
 * with quoting.
 *
 * @see https://sqlite.org/lang_keywords.html
 * @see https://www.postgresql.org/docs/current/sql-keywords-appendix.html
 * @see https://dev.mysql.com/doc/refman/8.0/en/keywords.html
 */
export const SQL_RESERVED_KEYWORDS = [
  // Data manipulation
  "select",
  "insert",
  "update",
  "delete",
  "from",
  "where",
  "set",
  "values",
  // Table operations
  "create",
  "drop",
  "alter",
  "table",
  "index",
  "view",
  "trigger",
  "database",
  // Joins and relations
  "join",
  "inner",
  "outer",
  "left",
  "right",
  "cross",
  "full",
  "on",
  "using",
  // Clauses
  "order",
  "group",
  "by",
  "having",
  "limit",
  "offset",
  "distinct",
  "as",
  "case",
  "when",
  "then",
  "else",
  "end",
  // Logical
  "and",
  "or",
  "not",
  "in",
  "is",
  "null",
  "like",
  "between",
  "exists",
  // Constraints
  "primary",
  "foreign",
  "key",
  "references",
  "unique",
  "check",
  "constraint",
  "default",
  // Transactions
  "begin",
  "commit",
  "rollback",
  "transaction",
  // Aggregates (can cause confusion)
  "count",
  "sum",
  "avg",
  "min",
  "max",
  // Other commonly problematic
  "all",
  "any",
  "union",
  "except",
  "intersect",
  "column",
  "row",
  "rows",
  "for",
  "to",
  "into",
  "with",
  // High-risk specific keywords
  "user",
  "password",
  "role",
  "session",
  "grant",
  "revoke",
  "match",
  "natural",
] as const;
