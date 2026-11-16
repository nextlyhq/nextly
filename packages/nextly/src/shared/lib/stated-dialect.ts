/**
 * The database dialect the environment states, read without loading the
 * environment's schema: the dialects, the one a connection URL implies, and
 * the default. A module that imports nothing, so code that runs while Next.js
 * loads `next.config` (`withNextly`, which reads the migrations folder as
 * that dialect runs it) answers by the rules `shared/lib/env` parses with.
 *
 * @module shared/lib/stated-dialect
 */

/** The dialects this package supports. One list; the enum and the type both come from it. */
export const DIALECTS = ["postgresql", "mysql", "sqlite"] as const;
export type Dialect = (typeof DIALECTS)[number];

/**
 * The dialect a connection URL implies, or undefined when it implies nothing.
 *
 * These are the rules the database factory already applied; they live here now
 * so there is one answer rather than two, and so the answer is reached before
 * anything reads it.
 */
export function dialectFromUrl(url: unknown): Dialect | undefined {
  if (typeof url !== "string" || url === "") return undefined;
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return "postgresql";
  }
  if (url.startsWith("mysql://")) return "mysql";
  if (
    url.startsWith("file:") ||
    url.endsWith(".db") ||
    url.endsWith(".sqlite") ||
    url.endsWith(".sqlite3")
  ) {
    return "sqlite";
  }
  return undefined;
}

/** The dialect where the environment states none and its URL implies none. */
export const DEFAULT_DIALECT: Dialect = "postgresql";

/**
 * The dialect `env` states, as `shared/lib/env` resolves it: `DB_DIALECT`
 * when it names one, else the dialect `DATABASE_URL` implies, else the
 * default.
 */
export function statedDialect(
  env: Readonly<Record<string, string | undefined>>
): Dialect {
  const stated = env.DB_DIALECT;
  if ((DIALECTS as readonly string[]).includes(stated ?? "")) {
    return stated as Dialect;
  }
  return dialectFromUrl(env.DATABASE_URL) ?? DEFAULT_DIALECT;
}
