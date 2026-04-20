// --- Transaction hooks registry ---
import type { TransactionHooks } from "../../types/database";

export type DbLogLevel = "debug" | "info" | "warn" | "error" | "silent";

type DbLogCategory = "query" | "transaction" | "connection";

export interface DbLogEventBase {
  category: DbLogCategory;
  dialect: "postgresql" | "mysql" | "sqlite";
  op: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface DbQueryEvent extends DbLogEventBase {
  category: "query";
  paramsCount?: number;
  rowCount?: number;
  sql?: string;
}

export interface DbTxEvent extends DbLogEventBase {
  category: "transaction";
  phase:
    | "begin"
    | "commit"
    | "rollback"
    | "savepoint"
    | "release-savepoint"
    | "rollback-savepoint";
  attempt?: number;
}

export interface DbConnEvent extends DbLogEventBase {
  category: "connection";
  op:
    | "connect"
    | "disconnect"
    | "health-ok"
    | "health-fail"
    | "failover-rotate";
  url?: string;
  fromUrl?: string;
  toUrl?: string;
}

export interface DbLogger {
  log(level: DbLogLevel, event: DbLogEventBase): void;
}

const levelPriority: Record<Exclude<DbLogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// simple local config – you can adjust manually if needed
const DB_LOG_ENABLED = false;
const DB_LOG_LEVEL: DbLogLevel = "warn";
const DB_LOG_SQL = false;

function isEnabled(level: DbLogLevel): boolean {
  if (!DB_LOG_ENABLED) return false;
  if (DB_LOG_LEVEL === "silent") return false;
  if (level === "silent") return false;

  const current = levelPriority[DB_LOG_LEVEL as Exclude<DbLogLevel, "silent">];
  const req = levelPriority[level as Exclude<DbLogLevel, "silent">];
  return req >= current;
}

class DefaultDbLogger implements DbLogger {
  log(level: DbLogLevel, event: DbLogEventBase): void {
    if (!isEnabled(level)) return;
    const timeIso = new Date().toISOString();
    const payload = { time: timeIso, level, ...event };

    if (level === "error") console.error("[db]", JSON.stringify(payload));
    else if (level === "warn") console.warn("[db]", JSON.stringify(payload));
    else console.log("[db]", JSON.stringify(payload));
  }
}

let activeLogger: DbLogger = new DefaultDbLogger();

export function setDbLogger(logger: DbLogger): void {
  activeLogger = logger;
}

export function getDbLogger(): DbLogger {
  return activeLogger;
}

export function logDbQuery(
  level: DbLogLevel,
  event: Omit<DbQueryEvent, "category">
): void {
  const full = {
    ...(event as DbQueryEvent),
    category: "query",
  } as DbQueryEvent;
  if (!DB_LOG_SQL) {
    delete (full as Record<string, unknown>).sql;
  }
  activeLogger.log(level, full);
}

export function logDbTx(
  level: DbLogLevel,
  event: Omit<DbTxEvent, "category">
): void {
  const full = {
    ...(event as DbTxEvent),
    category: "transaction",
  } as DbTxEvent;
  activeLogger.log(level, full);
}

export function logDbConn(
  level: DbLogLevel,
  event: Omit<DbConnEvent, "category">
): void {
  const full = {
    ...(event as DbConnEvent),
    category: "connection",
  } as DbConnEvent;
  activeLogger.log(level, full);
}

export function nowMs(): number {
  if (typeof process !== "undefined" && typeof process.hrtime === "function") {
    const ns = process.hrtime.bigint();
    return Number(ns / BigInt(1_000_000));
  }
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

let activeTxHooks: TransactionHooks = {};

export function setTransactionHooks(hooks: TransactionHooks): void {
  activeTxHooks = hooks || {};
}

export function getTransactionHooks(): TransactionHooks {
  return activeTxHooks;
}

// --- Auth logging ---
export type AuthLogLevel = "debug" | "info" | "warn" | "error";

export interface AuthLogEvent {
  category: "auth";
  op:
    | "sign-in"
    | "sign-out"
    | "create-user"
    | "update-user"
    | "link-account"
    | "session"
    | "error"
    | "permissions"
    | "cache"; // Permission cache operations
  userId?: string;
  provider?: string;
  isNewUser?: boolean;
  errorName?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface AuthLogger {
  log(level: AuthLogLevel, event: AuthLogEvent): void;
}

class DefaultAuthLogger implements AuthLogger {
  log(level: AuthLogLevel, event: AuthLogEvent): void {
    const timeIso = new Date().toISOString();
    const payload = { time: timeIso, level, ...event };
    if (level === "error") console.error("[auth]", JSON.stringify(payload));
    else if (level === "warn") console.warn("[auth]", JSON.stringify(payload));
    else console.log("[auth]", JSON.stringify(payload));
  }
}

let activeAuthLogger: AuthLogger = new DefaultAuthLogger();

export function setAuthLogger(logger: AuthLogger): void {
  activeAuthLogger = logger;
}

export function getAuthLogger(): AuthLogger {
  return activeAuthLogger;
}

function sanitizeAuthEvent(event: AuthLogEvent): AuthLogEvent {
  const clone = { ...event } as Record<string, unknown>;
  for (const key of [
    "email",
    "token",
    "sessionToken",
    "access_token",
    "refresh_token",
    "id_token",
    "password",
    "newPassword",
  ]) {
    if (key in clone) delete clone[key];
  }
  return clone as AuthLogEvent;
}

export function logAuth(level: AuthLogLevel, event: AuthLogEvent): void {
  activeAuthLogger.log(level, sanitizeAuthEvent(event));
}
