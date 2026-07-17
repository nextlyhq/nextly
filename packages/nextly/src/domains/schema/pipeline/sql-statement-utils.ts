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
 * v1 emits one statement per array entry in every observed case, so this is
 * pure defense for multi-statement strings. The filter is a DENY-list
 * (blank fragments, `--` comment lines including drizzle's
 * `--> statement-breakpoint` markers) rather than a keyword allow-list: an
 * allow-list silently discarded any statement whose leading verb wasn't
 * enumerated, which is how a future kit verb (SAVEPOINT, VACUUM, …) would
 * get dropped mid-rebuild — #5782 territory. Safety filtering is owned by
 * filterUnsafeStatements / findUnexpectedDestructiveStatements downstream,
 * not by this splitter.
 */
export function splitStatements(sqlStatements: string[]): string[] {
  const out: string[] = [];
  for (const raw of sqlStatements) {
    const withoutMarkers = raw
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n");
    for (const piece of withoutMarkers
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0)) {
      out.push(piece);
    }
  }
  return out;
}

/**
 * True when an error is a re-run-over-existing-schema artifact that an
 * idempotent reconcile should tolerate: "already exists" (all dialects),
 * SQLite's "duplicate column name", MySQL's "Duplicate key name"/"Duplicate
 * column name". v1 wraps driver errors in DrizzleQueryError with the
 * original on `.cause`, so both messages are checked.
 */
export function isIdempotencyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return [msg, causeMsg].some(
    m =>
      m.includes("already exists") ||
      m.includes("duplicate column name") ||
      m.includes("Duplicate")
  );
}
