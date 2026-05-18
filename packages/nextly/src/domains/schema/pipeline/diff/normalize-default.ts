// Normalises database default-expression strings to a canonical form so the
// diff can compare desired-side (descriptor-authored) and live-side
// (introspected) defaults without emitting spurious change_column_default
// ops on every apply.
//
// Why this exists: PostgreSQL stores column defaults in a normalised form
// (`'draft'::character varying`, `42::integer`) while the desired-side
// descriptor authors the human-readable form (`'draft'`, `42`). Without
// normalisation, every Builder apply emits a change_column_default op for
// every system column with a default, which blocks the fast-path emitter
// and routes the apply back through drizzle-kit's slow pushSchema.
//
// Design principle — bounded, one-way collapses only:
//   - We strip PG's redundant `::<typename>` cast suffix from literal values.
//   - We lowercase a small set of known built-in no-arg function calls.
//   - Anything we don't recognise passes through unchanged. A real default
//     change is then caught by the diff as a legitimate
//     change_column_default op; we'd rather emit a false-positive op than
//     silently swallow a real one.
//
// Scope: PostgreSQL is the only dialect that currently surfaces this
// mismatch. MySQL/SQLite-specific equivalences can be added here when they
// emerge; the function signature is dialect-agnostic so callers don't need
// to know.

// The list of PG type names that PG appends as a `::<type>` cast suffix to
// literal defaults. Two-word types (`character varying`, `double precision`,
// `timestamp without time zone`) are handled by the suffix matcher below
// since they're a superset of single-word matches.
const PG_REDUNDANT_CAST_TYPES = [
  // Two-word forms come first so the regex prefers the longer match.
  "character varying",
  "character",
  "double precision",
  "timestamp without time zone",
  "timestamp with time zone",
  "time without time zone",
  "time with time zone",
  // Single-word forms.
  "text",
  "varchar",
  "bpchar",
  "integer",
  "bigint",
  "smallint",
  "numeric",
  "real",
  "boolean",
  "uuid",
  "jsonb",
  "json",
];

// Regex: match a closing `'` followed by `::<typename>` at end-of-string,
// OR a numeric literal / boolean keyword followed by `::<typename>` at
// end-of-string. Anchoring to end-of-string is critical so we don't strip
// `::text` that appears mid-expression (e.g. inside a string literal).
const CAST_SUFFIX_RE = new RegExp(
  `::(?:${PG_REDUNDANT_CAST_TYPES.join("|")})$`,
  "i"
);

// Built-in no-arg function calls that PG / Drizzle may emit in different
// cases. Conservative list: only functions that are guaranteed
// case-insensitive at the call site, called with no arguments. Adding to
// this list means "I've confirmed both sides of the diff treat these as
// equivalent."
const NORMALIZE_LOWERCASE_FUNCTIONS = new Set(["now()"]);

/**
 * Return the canonical form of a column-default expression for diff
 * comparison. `undefined` (no default) is passed through unchanged.
 */
export function normalizeDefault(expr: string | undefined): string | undefined {
  if (expr === undefined) return undefined;

  // Step 1: strip PG's redundant `::<type>` cast suffix when it follows a
  // closing string-literal quote or a bare literal (number / boolean).
  let normalised = stripRedundantCast(expr);

  // Step 2: lowercase a small set of known case-insensitive built-ins.
  const lower = normalised.toLowerCase();
  if (NORMALIZE_LOWERCASE_FUNCTIONS.has(lower)) {
    normalised = lower;
  }

  return normalised;
}

function stripRedundantCast(expr: string): string {
  // Only strip when the value before the `::` cast is a complete literal:
  //   - a closed string literal: ends with `'` (we don't have to validate
  //     the whole string — the closing `'` plus the suffix `::type` at EOS
  //     uniquely identifies the case)
  //   - a numeric literal or boolean keyword: matches `[0-9]+(?:\.[0-9]+)?`
  //     or `true|false`
  const match = expr.match(CAST_SUFFIX_RE);
  if (!match) return expr;

  const beforeCast = expr.slice(0, match.index);
  if (isCompleteLiteral(beforeCast)) {
    return beforeCast;
  }
  return expr;
}

function isCompleteLiteral(value: string): boolean {
  // String literal: starts and ends with `'`. PG doubles internal quotes,
  // so any `'` we see inside is part of the literal — the closing `'` is
  // simply the last character.
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return true;
  }
  // Numeric literal (optionally negative, with optional decimal).
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) return true;
  // Boolean keyword.
  if (value === "true" || value === "false") return true;
  return false;
}
