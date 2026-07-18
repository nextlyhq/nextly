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
 * True when an error is a re-run-over-existing-schema artifact that an
 * idempotent reconcile should tolerate. The match is anchored to the
 * documented DDL wordings ONLY — "already exists" (all dialects), SQLite's
 * "duplicate column name", MySQL's "Duplicate key name"/"Duplicate column
 * name". It must NEVER match MySQL's `Duplicate entry ... for key` (error
 * 1062): that is a runtime DATA error from a rebuild's INSERT..SELECT, and
 * swallowing it would let the subsequent DROP destroy the rows that failed
 * to copy. v1 wraps driver errors in DrizzleQueryError with the original on
 * `.cause`, so both messages are checked.
 */
export function isIdempotencyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return [msg, causeMsg].some(m =>
    [/already exists/i, /duplicate column name/i, /duplicate key name/i].some(
      p => p.test(m)
    )
  );
}
