// Shared SQL-statement text utilities for the schema apply paths.
//
// fresh-push.ts and drizzle-statement-executor.ts previously each carried a
// private statement splitter and a private idempotency-error matcher — and
// they drifted (PRAGMA had to be added to two keyword lists in one PR; the
// executor's matcher lacked MySQL's "Duplicate key name" wording). One
// source of truth for both policies lives here.

/**
 * Split raw kit-emitted SQL entries into individually executable statements.
 *
 * v1's pushSchema emits one statement per array entry, and generateMigration
 * separates statements with `--> statement-breakpoint` marker lines — so the
 * ONLY split points are those explicit markers. Statements are never split
 * on semicolons: a lexical `;` split corrupts string literals and
 * dialect-specific bodies and can leave a non-transactional reconcile
 * half-applied. Standalone `--` comment lines are dropped; everything else
 * passes through verbatim (a keyword allow-list here once silently
 * discarded unknown verbs — #5782 territory). Safety filtering is owned by
 * filterUnsafeStatements / findUnexpectedDestructiveStatements downstream.
 */
export function splitStatements(sqlStatements: string[]): string[] {
  const out: string[] = [];
  for (const raw of sqlStatements) {
    for (const piece of raw.split(/^\s*-->\s*statement-breakpoint\s*$/m)) {
      const cleaned = piece
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (cleaned.length > 0) out.push(cleaned);
    }
  }
  return out;
}

/**
 * Test an error's own message AND its cause's against a set of wordings.
 *
 * drizzle-kit v1 wraps driver errors in a DrizzleQueryError carrying the
 * original on `.cause`, so the dialect's actual wording is one level down and
 * reading only the top message misses every one of them.
 */
function errorSays(err: unknown, patterns: RegExp[]): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return [msg, causeMsg].some(m => patterns.some(p => p.test(m)));
}

/**
 * True when an error is a re-run-over-existing-schema artifact that an
 * idempotent reconcile should tolerate. The match is anchored to the
 * documented DDL wordings ONLY — "already exists" (all dialects), SQLite's
 * "duplicate column name", MySQL's "Duplicate key name"/"Duplicate column
 * name", and MySQL's `Can't DROP '<name>'; check that column/key exists`
 * (error 1091). It must NEVER match MySQL's `Duplicate entry ... for key`
 * (error 1062): that is a runtime DATA error from a rebuild's INSERT..SELECT,
 * and swallowing it would let the subsequent DROP destroy the rows that failed
 * to copy. v1 wraps driver errors in DrizzleQueryError with the original on
 * `.cause`, so both messages are checked.
 *
 * Idempotency runs in BOTH directions. "Already there" on a create and
 * "already gone" on a drop are the same fact — the schema is in the state the
 * statement was asking for — and only the first direction was covered here,
 * so a reconcile that removed anything could still fail on a redundant drop.
 * Dropping a MySQL foreign key is exactly that case: drizzle-kit emits
 * `DROP CONSTRAINT` followed by a `DROP INDEX` for the index MySQL maintains
 * behind the key, and the first statement has already removed it.
 *
 * Error 1091 is matched by its full wording rather than a bare "does not
 * exist", which on PostgreSQL is also what a statement referencing a genuinely
 * missing table reports — swallowing that would hide a real broken reconcile.
 */
export function isIdempotencyError(err: unknown): boolean {
  return errorSays(err, [
    /already exists/i,
    /duplicate column name/i,
    /duplicate key name/i,
    /check that column\/key exists/i,
  ]);
}
