import { NextlyError } from "../errors/nextly-error";

import { isDbError } from "./errors";

/**
 * Pattern A from spec §8.3: wrap any DB-touching block so a DbError thrown
 * inside is auto-converted to a NextlyError with a generic public message.
 *
 * Use this in the 90% case at repository or service boundaries:
 *
 * ```ts
 * const post = await withDbErrors(() =>
 *   db.insert(posts).values(input).returning(),
 * );
 * ```
 *
 * For security-sensitive flows (e.g., registration silent-success on a
 * unique-violation against `users_email_key`), catch the DbError yourself
 * (Pattern B) and decide before re-throwing.
 *
 * NextlyError instances and plain Errors thrown inside are re-thrown
 * unchanged so callers' explicit error semantics survive.
 */
export async function withDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDbError(err)) {
      throw NextlyError.fromDatabaseError(err);
    }
    throw err;
  }
}
