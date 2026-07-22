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

/**
 * Return the canonical form of a column-default expression for diff
 * comparison. `undefined` (no default) is passed through unchanged.
 */
export function normalizeDefault(expr: string | undefined): string | undefined {
  if (expr === undefined) return undefined;

  // Step 1: strip PG's redundant `::<type>` cast suffix when it follows a
  // closing string-literal quote or a bare literal (number / boolean).
  let normalised = stripRedundantCast(expr);

  // Step 2: unwrap a string literal to the value it denotes.
  normalised = unquoteStringLiteral(normalised);

  // Step 3: drop parentheses that wrap the whole expression. SQLite requires
  // them when a default is an expression (`DEFAULT (unixepoch())`) and then
  // reports the column back through PRAGMA without them, as `unixepoch()`.
  // The desired side keeps whatever the schema wrote, so without this the two
  // never agree and the column emits a default change on every reconcile.
  // Runs after the unquote so a quoted `'(unixepoch())'` — which the unquote
  // deliberately leaves alone — is not reduced into the expression it spells.
  normalised = stripWrappingParens(normalised);

  // Step 4: lowercase the built-in keywords, which the dialects report back in
  // whatever case they please — MySQL renders a DATETIME default as
  // `current_timestamp(3)` where the schema wrote `CURRENT_TIMESTAMP(3)`.
  // Bounded to the keyword list plus an optional precision argument, so a
  // user-defined function keeps its case: `MyFunc()` may well be a different
  // identifier from `myfunc()` depending on how it was quoted.
  if (KEYWORD_WITH_OPTIONAL_PRECISION.test(normalised.trim())) {
    normalised = normalised.toLowerCase();
  }

  return normalised;
}

/**
 * Contents that must keep their quotes, because unquoted they would read as
 * something other than a string.
 *
 * `'now()'` is the word "now()" stored in a text column; `now()` is a call
 * evaluated per row. Unwrap the first and the two compare equal, so a change
 * between them is reported as no change at all and the column keeps a default
 * nobody intended. The same holds for `'true'` against the boolean, `'0'`
 * against the number, and `'CURRENT_TIMESTAMP'` against the keyword.
 *
 * Matching is deliberately broad — anything that calls, any bare keyword, any
 * number — because the cost of the two sides is not symmetric. Declining to
 * unwrap costs a spurious op, which this module has always preferred; a wrong
 * unwrap silently drops a real migration.
 */
const NILADIC_KEYWORDS = [
  // Literals.
  "true",
  "false",
  "null",
  // Date/time keywords that need no call syntax. PostgreSQL accepts all of
  // these bare; SQLite accepts the CURRENT_ trio; MySQL accepts
  // CURRENT_TIMESTAMP.
  "current_timestamp",
  "current_date",
  "current_time",
  "localtime",
  "localtimestamp",
  // Identity keywords, all bare-callable in PostgreSQL.
  "current_user",
  "current_role",
  "current_schema",
  "current_catalog",
  "session_user",
  "system_user",
  "user",
].join("|");

// The built-in keywords, alone or with a fractional-seconds precision, and
// `now()`. These name the same thing in any case, so both sides of the diff
// can be reduced to lower case; anything outside this set is left as written.
const KEYWORD_WITH_OPTIONAL_PRECISION = new RegExp(
  `^(?:now\\(\\)|(?:${NILADIC_KEYWORDS})(?:\\s*\\(\\s*\\d+\\s*\\))?)$`,
  "i"
);

const EXPRESSION_SHAPED = new RegExp(
  // Anything parenthesised (`(unixepoch())`), anything that calls (`now()`,
  // `gen_random_uuid()`), any number in any
  // form a dialect accepts (`1`, `-1`, `+1`, `.5`, `-.5`), or any keyword
  // above standing alone.
  `^\\s*(?:\\(|[\\w.]+\\s*\\(|[-+]?\\.?\\d|(?:${NILADIC_KEYWORDS})\\s*$)`,
  "i"
);

/**
 * Reduce a quoted string literal to its contents.
 *
 * The two sides of the diff read a string default from different places and
 * so quote it differently: the live side reads the DDL, where a string is
 * written `'pending'`, while the desired side reads the Drizzle column, whose
 * `default` holds the JavaScript string `pending`. Nothing before this made
 * them comparable, so every string-defaulted column produced a
 * `change_column_default` op on every diff — on all three dialects, not only
 * the one where it was first noticed.
 *
 * Left un-normalised the op is not merely noise: it keeps the reconcile from
 * seeing a clean database, and on SQLite the rebuild that follows takes the
 * table's indexes with it.
 *
 * Two things are never unwrapped. A literal with an interior quote, because
 * both PG and SQLite escape by doubling and the contents cannot be recovered
 * by removing the outer pair. And a literal whose contents would read as an
 * expression, so that a quoted `'now()'` can never compare equal to a called
 * `now()`.
 */
function unquoteStringLiteral(expr: string): string {
  if (expr.length < 2) return expr;
  if (!expr.startsWith("'") || !expr.endsWith("'")) return expr;
  const inner = expr.slice(1, -1);
  if (inner.includes("'")) return expr;
  if (EXPRESSION_SHAPED.test(inner)) return expr;
  return inner;
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

/**
 * Remove parentheses that wrap the entire expression.
 *
 * SQLite will not accept a bare function call as a default — it has to be
 * written `DEFAULT (unixepoch())` — and then reports the column back through
 * `PRAGMA table_info` as `unixepoch()`, without them. One side of the diff
 * therefore always carries a pair the other never sees.
 *
 * Only a pair that encloses everything is removed, and only when it genuinely
 * closes at the end: `(a) + (b)` opens and closes twice, so its first `(` does
 * not match its last `)` and the expression is left as written. Stripping
 * there would produce `a) + (b`, which is not the same default and not even
 * valid SQL.
 */
function stripWrappingParens(expr: string): string {
  let current = expr;
  let peeled = false;

  for (;;) {
    // Whitespace beside a parenthesis is insignificant, but whitespace inside
    // a string default is not: `' pending '` and `'pending'` are different
    // values. So the trim is scoped to the paren test, and the untouched
    // input is what comes back when there is nothing to peel.
    const candidate = current.trim();
    if (!candidate.startsWith("(") || !candidate.endsWith(")")) break;

    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] === "(") depth++;
      else if (candidate[i] === ")") {
        depth--;
        // Back to zero before the last character means this `(` closed early,
        // so the outer pair is not a wrapper.
        if (depth === 0 && i < candidate.length - 1) {
          closesAtEnd = false;
          break;
        }
      }
    }
    if (!closesAtEnd || depth !== 0) break;

    current = candidate.slice(1, -1);
    peeled = true;
  }

  return peeled ? current.trim() : expr;
}
