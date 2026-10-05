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
// MySQL surfaces two more, both reported against the schema this project
// itself writes:
//   - `now()` and `CURRENT_TIMESTAMP` are synonyms (in PostgreSQL too), so a
//     timestamp column reported one way and authored the other looked changed.
//     They collapse into `now()`, the form already canonical here.
//   - A boolean column stores 1/0, because MySQL booleans ARE `tinyint(1)`,
//     while the desired side authors `true`/`false`. That collapse is applied
//     ONLY when the column's type is boolean: for an integer column a default
//     of `1` means the number one, and treating it as `true` would hide a real
//     change. Hence the optional column-type argument.
//   - A hex string default, `(CONVERT(X'7b7d' USING utf8mb4))`, which is how a
//     TEXT or JSON column's default is written because MySQL takes only an
//     expression there, is reported back as `convert(0x7b7d using utf8mb4)`.
//
// And one both servers share: a NUMERIC column's default is reported in the
// server's own spelling of the number. PostgreSQL quotes a negative one and
// casts it (`'-1'::integer` for `-1`), and MySQL pads a decimal to its scale
// (`1.50` for `1.5`). On a numeric column those denote one value, so they are
// compared as numbers — gated on the column type exactly as the boolean
// collapse is, because in a text column `'1.50'` and `'1.5'` are different
// strings.

import { normalizeType } from "./normalize-type";

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
export function normalizeDefault(
  expr: string | undefined,
  // The column's declared type, when the caller has it. Only consulted to
  // decide whether a bare 1/0 denotes a boolean.
  columnType?: string
): string | undefined {
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

  // Step 3b: MySQL's report of a hex string default, in the one spelling the
  // desired side writes it with.
  normalised = canonicalHexConvert(normalised);

  // Step 4: lowercase the built-in keywords, which the dialects report back in
  // whatever case they please — MySQL renders a DATETIME default as
  // `current_timestamp(3)` where the schema wrote `CURRENT_TIMESTAMP(3)`.
  // Bounded to the keyword list plus an optional precision argument, so a
  // user-defined function keeps its case: `MyFunc()` may well be a different
  // identifier from `myfunc()` depending on how it was quoted.
  if (KEYWORD_WITH_OPTIONAL_PRECISION.test(normalised.trim())) {
    normalised = normalised.toLowerCase();
  }

  // Step 5: `current_timestamp` and `now()` denote the same value, and MySQL
  // reports one where the schema authored the other — including with a
  // fractional-seconds precision, where a DATETIME(3) column authored
  // `CURRENT_TIMESTAMP(3)` reads back as `now(3)`. `now()` is the form this
  // codebase already treats as canonical, so the keyword collapses into it
  // and any precision is carried across unchanged. Whitespace inside the call
  // is insignificant to every dialect but not to a string compare, so
  // `CURRENT_TIMESTAMP ( 3 )` has to reduce to the same token as `now(3)`.
  //
  // A bare `now` is deliberately left alone: unlike the keywords it is not
  // callable without parentheses in any supported dialect, so an expression
  // that spells it that way is something else.
  const timestampKeyword = normalised.trim().match(TIMESTAMP_KEYWORD);
  if (timestampKeyword) {
    const precision = timestampKeyword[2];
    if (
      timestampKeyword[1] === "current_timestamp" ||
      precision !== undefined
    ) {
      normalised = precision ? `now(${precision})` : "now()";
    }
  }

  // Step 6: a boolean column's default, whichever spelling the dialect
  // reports. Gated on the column type because `1` is only "true" where the
  // column is a boolean — elsewhere it is the number.
  if (normalizeType(columnType) === "bool") {
    const b = normalised.trim().toLowerCase();
    if (b === "1" || b === "true") return "true";
    if (b === "0" || b === "false") return "false";
  }

  // Step 7: a numeric column's default, as the number it denotes.
  if (isNumericColumnType(columnType)) {
    const number = canonicalNumber(normalised);
    if (number !== undefined) return number;
  }

  return normalised;
}

/**
 * Column types whose default is a number, as `normalizeType` reports them.
 *
 * The canonical PostgreSQL and SQLite tokens, plus MySQL's spellings that
 * `normalizeType` passes through (`double`, `float`, `tinyint`, `mediumint`).
 * `tinyint(1)` is absent on purpose: it normalises to `bool`, which step 6
 * has already answered.
 */
const NUMERIC_COLUMN_TYPES = new Set([
  "int2",
  "int4",
  "int8",
  "numeric",
  "float4",
  "float8",
  "double",
  "float",
  "tinyint",
  "mediumint",
]);

function isNumericColumnType(columnType: string | undefined): boolean {
  // MySQL may qualify an integer type (`int unsigned`, `bigint zerofill`);
  // the qualifier constrains the range, not how a default is spelled.
  const base = normalizeType(
    columnType?.replace(/\s+(?:unsigned|signed|zerofill)\b/gi, "")
  );
  return base !== undefined && NUMERIC_COLUMN_TYPES.has(base);
}

/**
 * A number literal, bare or single-quoted, in one spelling per value.
 *
 * Exact rather than through a JavaScript number, which would round: two
 * decimals that differ in the twentieth digit are different defaults. The
 * digits are stripped of leading and trailing zeros and any exponent is
 * applied, so `1.50`, `1.5` and `15e-1` all read `1.5`, and `1e3` reads
 * `1000`. Undefined for anything that is not a single number.
 */
function canonicalNumber(expr: string): string | undefined {
  const match = /^\s*(?:'([^']*)'|(\S+))\s*$/.exec(expr);
  const text = match?.[1] ?? match?.[2];
  if (text === undefined) return undefined;
  const parts = /^([-+]?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(text.trim());
  if (parts === null) return undefined;
  const [, sign, whole = "", fraction = "", exponent = "0"] = parts;
  if (whole === "" && fraction === "") return undefined;
  const allDigits = `${whole}${fraction}`;
  const significant = allDigits.replace(/^0+/, "");
  if (significant === "") return "0";
  const trimmed = significant.replace(/0+$/, "");
  const scale =
    Number(exponent) - fraction.length + (significant.length - trimmed.length);
  const minus = sign === "-" ? "-" : "";
  // Written out in positional notation, so an integer default reads as the
  // integer; an exponent too large to spell out keeps exponent form, which is
  // still one spelling per value.
  if (Math.abs(scale) > MAX_POSITIONAL_SCALE) {
    return `${minus}${trimmed}e${String(scale)}`;
  }
  if (scale >= 0) return `${minus}${trimmed}${"0".repeat(scale)}`;
  const padded = trimmed.padStart(-scale + 1, "0");
  return `${minus}${padded.slice(0, scale)}.${padded.slice(scale)}`;
}

/** The widest exponent {@link canonicalNumber} writes out in full. */
const MAX_POSITIONAL_SCALE = 400;

/**
 * `CONVERT(X'<hex>' USING <charset>)`, as written, and
 * `convert(0x<hex> using <charset>)`, as MySQL reports it, in one spelling.
 *
 * Only this exact shape: a hex literal converted to a named character set.
 * The bytes are compared case-insensitively because hex digits are, and the
 * character set name is an identifier MySQL matches without regard to case.
 */
function canonicalHexConvert(expr: string): string {
  const match =
    /^\s*convert\s*\(\s*(?:x'([0-9a-f]*)'|0x([0-9a-f]*))\s+using\s+(\w+)\s*\)\s*$/i.exec(
      expr
    );
  if (match === null) return expr;
  const hex = (match[1] ?? match[2] ?? "").toLowerCase();
  return `convert(0x${hex} using ${(match[3] ?? "").toLowerCase()})`;
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

// The built-in keywords, alone or called with an optional fractional-seconds
// precision, and `now(...)`. These name the same thing in any case, so both
// sides of the diff can be reduced to lower case; anything outside this set is
// left as written. The precision is optional and may be empty because MySQL
// accepts `CURRENT_TIMESTAMP()` as a call with no argument.
const KEYWORD_WITH_OPTIONAL_PRECISION = new RegExp(
  `^(?:now\\s*\\(\\s*\\d*\\s*\\)|(?:${NILADIC_KEYWORDS})(?:\\s*\\(\\s*\\d*\\s*\\))?)$`,
  "i"
);

// The two spellings of "the current timestamp", with the precision they may
// carry. Applied after the lowercase pass, so it needs no `i` flag; the
// capture groups are the keyword and the precision digits.
const TIMESTAMP_KEYWORD = /^(current_timestamp|now)(?:\s*\(\s*(\d*)\s*\))?$/;

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
