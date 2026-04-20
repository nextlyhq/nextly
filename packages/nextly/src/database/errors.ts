import type { SupportedDialect } from "../types/database";

// 🌟 Big Picture
// This file is a translator for database errors.
// Databases throw scary codes like "23505" or "SQLITE_BUSY".
// Your code takes those scary codes and says: “Oh, this means duplicate row” or “This means timeout.”
// It wraps them inside a friendly DbError class, with kind, dialect, and message.
// Think of it as a dictionary that turns alien DB codes into human-friendly words ✅.

// 👉 A list of labels that errors can be.
// Example: "deadlock" = “two kids fighting over the same toy, neither lets go.”
// "unique-violation" = “trying to add two kids with the same ID number.”
// "timeout" = “the kid took too long to answer.”
// ✅ This makes your error system easy to understand.
export type DbErrorKind =
  | "deadlock"
  | "serialization-failure"
  | "timeout"
  | "connection-lost"
  | "unique-violation"
  | "fk-violation"
  | "not-null-violation"
  | "syntax"
  | "constraint"
  | "internal";

//   👉 It’s like a special error wrapper:
// It remembers what kind of DB error it is (unique-violation, timeout, etc).
// Which database it came from (postgresql, mysql, sqlite).
// Any extra info (code, meta, cause).
// ⚠️ Small improvement: this as any).cause = args.cause; is a hack because older TypeScript doesn’t support cause. Maybe in newer TS you can safely use the built-in ErrorOptions.
export class DbError extends Error {
  public readonly kind: DbErrorKind;
  public readonly dialect: SupportedDialect;
  public readonly code?: string | undefined;
  public readonly meta?: Record<string, unknown> | undefined;
  public override readonly cause?: unknown;

  constructor(args: {
    message: string;
    kind: DbErrorKind;
    dialect: SupportedDialect;
    code?: string | undefined;
    meta?: Record<string, unknown> | undefined;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "DbError";
    this.kind = args.kind;
    this.dialect = args.dialect;
    this.code = args.code;
    this.meta = args.meta;
    // Bypass readonly to assign cause after super(); class fields with
    // useDefineForClassFields (ES2022 default) reset values set by super().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).cause = args.cause;
  }
}

// 👉 This just checks if something is really a DbError.
// ✅ Helpful for type narrowing.
// ⚠️ But it only checks name and kind. Someone could fake it. If you want stronger safety, you could check instanceof DbError.
export function isDbError(err: unknown): err is DbError {
  // Type-narrow the unknown error to safely access .name and .kind
  // without casting to any.
  if (!err || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;
  return obj.name === "DbError" && typeof obj.kind === "string";
}

// 👉 This is the main translator:
// If the error is already a DbError, just return it.
// Otherwise:
// Pull out the error code (safeCode).
// Translate that code to a kind (using mapPostgresCodeToKind, etc).
// If code is missing, use heuristics (like checking the message text).
// Handle common Node.js error codes (ECONNRESET, ETIMEDOUT).
// Wrap everything nicely inside a new DbError.
// ✅ Very powerful — now every DB driver’s messy errors become one unified shape.
// ⚠️ Improvement: If code/message is missing, maybe log the raw error for debugging, not just return "internal".
export function toDbError(
  dialect: SupportedDialect,
  error: unknown,
  meta?: Record<string, unknown>
): DbError {
  if (isDbError(error)) return error;
  const code = safeCode(error);
  // Safely extract message from unknown error via type narrowing
  const message = String(
    (error != null && typeof error === "object" && "message" in error
      ? (error as Record<string, unknown>).message
      : undefined) ?? "Database error"
  );

  let kind: DbErrorKind = "internal";
  switch (dialect) {
    case "postgresql":
      kind = mapPostgresCodeToKind(code);
      break;
    case "mysql":
      kind = mapMySqlCodeToKind(code);
      break;
    case "sqlite":
      kind = mapSqliteCodeToKind(code);
      break;
  }

  // Heuristic override: some drivers surface only generic constraint codes but
  // include a discriminative message indicating UNIQUE violations.
  if (
    (dialect === "mysql" || dialect === "sqlite") &&
    (kind === "constraint" || kind === "internal") &&
    isLikelyUniqueViolationMessage(dialect, message)
  ) {
    kind = "unique-violation";
  }

  // Fallbacks based on common Node errors when code is not a DB symbol
  if (kind === "internal" && code) {
    const c = code.toUpperCase();
    if (c === "ECONNRESET" || c.includes("PROTOCOL_CONNECTION_LOST"))
      kind = "connection-lost";
    else if (c === "ETIMEDOUT") kind = "timeout";
  }

  return new DbError({ message, kind, dialect, code, meta, cause: error });
}

// 🔹 safeCode
// 👉 This function digs around the error object and tries every possible place (error.code, error.sqlState, error.errno, etc) to find the DB error code.
// ✅ Good defensive coding.
// ⚠️ Could get messy with weird drivers, but you covered most cases. Nice.
function safeCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  // Cast to Record to defensively probe common DB driver error properties.
  // DB drivers expose non-standard properties (code, sqlState, errno, etc.)
  // so we must use a loose record type to access them safely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = error as Record<string, any>;
  // Prefer string codes; fall back to numeric errno where present
  let c: unknown = e.code ?? e.sqlState ?? e.state ?? e.errno ?? undefined;
  // For Postgres drivers, SQLSTATE can also be at error.constraint / detail; prefer code property if present
  if (!c && typeof e.originalError?.code === "string") c = e.originalError.code;
  if (!c && typeof e.cause?.code === "string") c = e.cause.code;
  if (!c && typeof e.severity === "string" && typeof e.code === "string")
    c = e.code;
  if (typeof c === "number") return String(c);
  if (typeof c === "string" && c.length > 0) return c;
  return undefined;
}

function mapPostgresCodeToKind(code?: string): DbErrorKind {
  if (!code) return "internal";
  const c = code.toUpperCase();
  if (c === "40P01") return "deadlock";
  if (c === "40001") return "serialization-failure";
  if (c === "57014") return "timeout"; // query_canceled (often statement_timeout)
  if (c === "23505") return "unique-violation";
  if (c === "23503") return "fk-violation";
  if (c === "23502") return "not-null-violation";
  if (c === "42601") return "syntax";
  if (c.startsWith("08") || c === "57P01") return "connection-lost"; // connection exceptions / admin shutdown
  if (c.startsWith("23")) return "constraint"; // integrity constraint violation (generic)
  return "internal";
}

function mapMySqlCodeToKind(code?: string): DbErrorKind {
  if (!code) return "internal";
  const c = code.toUpperCase();
  // Numeric variants sometimes come through as strings
  if (c === "1213" || c === "ER_LOCK_DEADLOCK") return "deadlock";
  if (c === "1205" || c === "ER_LOCK_WAIT_TIMEOUT") return "timeout";
  if (c === "1062" || c === "ER_DUP_ENTRY") return "unique-violation";
  if (c === "23000") return "constraint"; // Integrity constraint violation (generic SQLSTATE)
  if (c === "1064" || c === "ER_PARSE_ERROR") return "syntax";
  if (c === "1452" || c === "ER_NO_REFERENCED_ROW_2") return "fk-violation";
  if (c === "1451" || c === "ER_ROW_IS_REFERENCED_2") return "fk-violation";
  if (c === "ECONNRESET" || c.includes("PROTOCOL_CONNECTION_LOST"))
    return "connection-lost";
  if (c === "ETIMEDOUT") return "timeout";
  return "internal";
}

function mapSqliteCodeToKind(code?: string): DbErrorKind {
  if (!code) return "internal";
  const c = code.toUpperCase();
  if (c === "SQLITE_BUSY" || c === "SQLITE_LOCKED") return "deadlock";
  if (c === "SQLITE_CONSTRAINT_UNIQUE") return "unique-violation";
  if (c === "SQLITE_CONSTRAINT_PRIMARYKEY") return "unique-violation";
  if (c === "SQLITE_CONSTRAINT_FOREIGNKEY") return "fk-violation";
  if (c === "SQLITE_CONSTRAINT_NOTNULL") return "not-null-violation";
  if (c === "SQLITE_INTERRUPT") return "timeout";
  if (c === "SQLITE_ERROR") return "syntax";
  if (c.startsWith("SQLITE_CONSTRAINT")) return "constraint";
  return "internal";
}

function isLikelyUniqueViolationMessage(
  dialect: SupportedDialect,
  message: string
): boolean {
  const m = message.toLowerCase();
  if (dialect === "mysql") {
    // Typical mysql2 messages: "Duplicate entry '...' for key '...'")
    return m.includes("duplicate entry") || m.includes("duplicate key");
  }
  if (dialect === "sqlite") {
    // better-sqlite3: "UNIQUE constraint failed: table.column"
    return m.includes("unique constraint failed");
  }
  return false;
}

// 🎯 Final Kid-Friendly Summary
// Imagine you’re the teacher of three classrooms (Postgres, MySQL, SQLite).
// Sometimes kids yell weird codes like "23505" or "ER_LOCK_DEADLOCK".
// You, the teacher, have a translator book (this file) that says:
// "23505" = “unique violation”
// "1213" = “deadlock”
// "SQLITE_BUSY" = “database is locked”
// Then you write it in a nice report card (DbError) that says:
// Kind: What happened (timeout, deadlock, etc).
// Dialect: Which classroom it came from.
// Message: What the kid actually said.
// This way, no matter which class misbehaves, you always understand it in plain English ✅.
// ⚡ Overall review:
// Extremely good design. You unify 3 different DBs into one clean error shape.
// Defensive coding is strong (safeCode, heuristics).
// Logs would be useful when you fall back to "internal".
// Maybe truncate very large error messages.
