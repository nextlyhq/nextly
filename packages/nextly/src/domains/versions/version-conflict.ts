/**
 * Concurrency handling for durable version-number allocation.
 *
 * Capture reads `max(version_no) + 1` and inserts; under concurrent writes to
 * the SAME document two callers can read the same max and collide on the seq
 * unique index. A collision is a lost race, not a user error, so capture raises
 * a distinct {@link VersionConflictError} and the write path re-runs the whole
 * transaction (a unique violation aborts the surrounding transaction on
 * Postgres, so only a full rollback-and-retry is safe cross-dialect). SQLite
 * serializes transactions and never collides; Postgres/MySQL can.
 *
 * @module domains/versions/version-conflict
 */

import { isDbError } from "../../database/errors";
import { NextlyError } from "../../errors/nextly-error";

/**
 * Raised by version capture when the version_no insert loses an allocation
 * race. Distinct from a content unique violation (e.g. a unique field on the
 * document) so the retry re-runs only on a genuine version_no collision.
 *
 * Routes through {@link NextlyError} (code `CONFLICT`, 409) so that if it ever
 * reaches the API boundary — e.g. after retry exhaustion — the client gets the
 * structured `{ code, message, requestId }` envelope, not a bare error. The
 * `name`/`isVersionConflict` marker is preserved so the retry can still detect
 * it inside a wrapped `cause` chain.
 */
export class VersionConflictError extends NextlyError {
  readonly isVersionConflict = true as const;

  constructor(cause?: unknown) {
    super({
      code: "CONFLICT",
      publicMessage:
        "The resource has changed since you last loaded it. Please refresh and try again.",
      logMessage: "Version number allocation conflict",
      logContext: { reason: "version" },
      cause: cause instanceof Error ? cause : undefined,
    });
    // NextlyError's constructor sets `name = "NextlyError"`; restore the
    // specific marker so hasVersionConflict() finds it by name after the
    // adapter wraps this error in a DatabaseError (it lands one `cause` down).
    this.name = "VersionConflictError";
  }
}

// Raw driver unique-violation identifiers by dialect. The transaction-context
// insert path throws the driver error directly — it is NOT normalized to a
// nextly `DbError` until it escapes the transaction — so capture must recognize
// the raw driver codes (and the adapter's own `DatabaseError`) at the insert
// site, where it still knows the insert targeted `nextly_versions`.
const RAW_UNIQUE_CODES = new Set<string>([
  "23505", // PostgreSQL unique_violation (SQLSTATE)
  "ER_DUP_ENTRY", // MySQL
  "SQLITE_CONSTRAINT_UNIQUE", // better-sqlite3
  "SQLITE_CONSTRAINT_PRIMARYKEY",
]);

/**
 * True when `err` is a unique-constraint violation in ANY of the forms it can
 * take between the driver and the nextly service layer: a raw driver error
 * (tx-context insert path), the adapter's `DatabaseError` (`kind:
 * "unique_violation"`, underscore), or a fully-normalized nextly `DbError`
 * (`kind: "unique-violation"`, hyphen). Capture only inserts into
 * `nextly_versions`, whose sole unique index is the version_no sequence, so any
 * unique violation from that insert is a version_no collision.
 */
function isUniqueViolationShape(err: unknown): boolean {
  // Fully-normalized nextly DbError (service-layer boundary).
  if (isDbError(err) && err.kind === "unique-violation") return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; errno?: unknown; kind?: unknown };
  // Adapter-layer DatabaseError: distinct name, underscore kind.
  if (e.kind === "unique_violation") return true;
  // MySQL surfaces the duplicate as errno 1062.
  if (e.errno === 1062) return true;
  // pg SQLSTATE / mysql code string / sqlite constraint code.
  if (typeof e.code === "string" && RAW_UNIQUE_CODES.has(e.code)) return true;
  return false;
}

/**
 * True when `err` (or its immediate `cause`) is a unique-constraint violation.
 * The one-level `cause` walk covers repo/driver wrappers that nest the original
 * error.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (isUniqueViolationShape(err)) return true;
  const cause = (err as { cause?: unknown } | null)?.cause;
  return cause !== undefined && isUniqueViolationShape(cause);
}

/**
 * Find the {@link VersionConflictError} in `err`'s `cause` chain, if any. The
 * adapter re-wraps a callback error as a DatabaseError when a transaction rolls
 * back, so the marker can sit one or more levels down.
 */
export function findVersionConflict(
  err: unknown
): VersionConflictError | undefined {
  let cursor: unknown = err;
  for (let depth = 0; depth < 10 && cursor; depth++) {
    if (cursor instanceof VersionConflictError) return cursor;
    if (
      typeof cursor === "object" &&
      (cursor as { name?: unknown }).name === "VersionConflictError"
    ) {
      return cursor as VersionConflictError;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True when a VersionConflictError sits anywhere in `err`'s cause chain. */
export function hasVersionConflict(err: unknown): boolean {
  return findVersionConflict(err) !== undefined;
}

/**
 * Run `fn`, re-running it when a version_no allocation race is detected. A
 * re-run re-reads the current max, so it advances to a free number. Other
 * errors propagate immediately. Defaults: 3 attempts, no delay (the re-read is
 * cheap and the racing writer has already committed). On exhaustion the
 * underlying {@link VersionConflictError} is surfaced (a NextlyError → clean
 * 409) rather than the raw wrapped driver error.
 */
export async function withVersionConflictRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 0;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const conflict = findVersionConflict(err);
      if (!conflict) throw err;
      lastError = conflict;
      if (delayMs > 0 && attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
