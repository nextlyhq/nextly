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

/**
 * Raised by version capture when the version_no insert loses an allocation
 * race. Distinct from a content unique violation (e.g. a unique field on the
 * document) so the retry re-runs only on a genuine version_no collision.
 */
export class VersionConflictError extends Error {
  readonly isVersionConflict = true as const;

  constructor(cause?: unknown) {
    super("Version number allocation conflict");
    this.name = "VersionConflictError";
    // Assign after super() so the ES2022 class-field init does not reset it.
    (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * True when `err` is a unique-constraint violation. Capture only inserts into
 * `nextly_versions`, whose sole unique index is the version_no sequence, so any
 * unique violation from that insert is a version_no collision.
 */
export function isUniqueViolation(err: unknown): boolean {
  return isDbError(err) && err.kind === "unique-violation";
}

/**
 * Walk the `cause` chain looking for a VersionConflictError. The adapter may
 * re-wrap a callback error as a DbError when a transaction rolls back, so the
 * marker can sit one or more levels down.
 */
export function hasVersionConflict(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; depth < 10 && cursor; depth++) {
    if (
      cursor instanceof VersionConflictError ||
      (typeof cursor === "object" &&
        (cursor as { name?: unknown }).name === "VersionConflictError")
    ) {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Run `fn`, re-running it when a version_no allocation race is detected. A
 * re-run re-reads the current max, so it advances to a free number. Other
 * errors propagate immediately. Defaults: 3 attempts, no delay (the re-read is
 * cheap and the racing writer has already committed).
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
      if (!hasVersionConflict(err)) throw err;
      lastError = err;
      if (delayMs > 0 && attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
