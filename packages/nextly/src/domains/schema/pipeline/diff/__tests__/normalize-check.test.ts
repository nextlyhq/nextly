// Tests for normalizeCheckExpression — the canonical form the diff compares
// check constraints in.
//
// The PostgreSQL inputs below are what `pg_get_constraintdef` returned on
// PostgreSQL 17 for the authored expression beside each, with the outer
// `CHECK (...)` removed the way introspection removes it. They are copied from
// the server rather than composed, because the whole point is that the
// server's spelling is not one anybody would write.

import { describe, expect, it } from "vitest";

import { normalizeCheckExpression as n } from "../normalize-check";

/** Asserts the two spellings reduce to one canonical form. */
function same(authored: string, reported: string): void {
  expect(n(reported)).toBe(n(authored));
}

describe("normalizeCheckExpression — PostgreSQL's spelling of an enum check", () => {
  it("reads a varchar column's ANY-over-ARRAY as the IN list it was written as", () => {
    same(
      "status IN ('a', 'b')",
      "((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))"
    );
    expect(
      n(
        "((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))"
      )
    ).toBe("status IN ('a', 'b')");
  });

  it("reads a text column's form, which carries no array cast", () => {
    same("t IN ('a', 'b')", "(t = ANY (ARRAY['a'::text, 'b'::text]))");
  });

  it("reads a one-value set, which PostgreSQL stores as an equality", () => {
    same("s IN ('a')", "((s)::text = 'a'::text)");
    expect(n("s IN ('a')")).toBe("s = 'a'");
  });

  it("reads NOT IN, stored as <> ALL, with an escaped quote intact", () => {
    same(
      "s NOT IN ('a', 'it''s')",
      "((s)::text <> ALL ((ARRAY['a'::character varying, 'it''s'::character varying])::text[]))"
    );
  });

  it("keeps the declared ORDER of the values", () => {
    // The enum helper emits values in declaration order on purpose; a reorder
    // is a change the diff must still see.
    expect(n("s IN ('a', 'b')")).not.toBe(n("s IN ('b', 'a')"));
  });

  it("still tells a different value set apart", () => {
    // The property the canonical form exists to preserve: equal only when the
    // sets are equal.
    expect(
      n(
        "((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))"
      )
    ).not.toBe(n("status IN ('a', 'b', 'c')"));
    expect(n("s IN ('a', 'b')")).not.toBe(n("s NOT IN ('a', 'b')"));
  });
});

describe("normalizeCheckExpression — hand-written checks on PostgreSQL", () => {
  it("drops the parentheses PostgreSQL adds and keeps the ones precedence needs", () => {
    same(
      "score >= 0 AND (score IS NULL OR score < 1000)",
      "(score >= 0) AND ((score IS NULL) OR (score < 1000))"
    );
    expect(n("(score >= 0) AND ((score IS NULL) OR (score < 1000))")).toBe(
      "score >= 0 AND (score IS NULL OR score < 1000)"
    );
  });

  it("does not let dropped parentheses merge two different groupings", () => {
    // `a AND (b OR c)` and `(a AND b) OR c` differ; a normaliser that stripped
    // every parenthesis would call them equal.
    expect(n("a = 1 AND (b = 1 OR c = 1)")).not.toBe(
      n("(a = 1 AND b = 1) OR c = 1")
    );
  });

  it("reads an AND chain alike however it was grouped", () => {
    same("a = 1 AND (b = 2 AND c = 3)", "((a = 1) AND (b = 2) AND (c = 3))");
  });

  it("reads BETWEEN, which PostgreSQL stores as its two comparisons", () => {
    same("n BETWEEN 1 AND 5", "(n >= 1) AND (n <= 5)");
    same("n NOT BETWEEN 1 AND 5", "(n < 1) OR (n > 5)");
  });

  it("reads LIKE, which PostgreSQL stores as ~~", () => {
    same(
      "t LIKE 'x%' AND length(t) > 2",
      "(t ~~ 'x%'::text) AND (length(t) > 2)"
    );
    same("t NOT LIKE 'x%'", "t !~~ 'x%'::text");
  });

  it("reads a negative number PostgreSQL re-quotes as a cast string", () => {
    same(
      "(n > 1 OR n < -1) AND n <> 0",
      "((n > 1) OR (n < '-1'::integer)) AND (n <> 0)"
    );
  });

  it("keeps arithmetic grouping PostgreSQL makes explicit", () => {
    same("p > 0.5 AND n + 1 * 2 > 3", "(p > 0.5) AND ((n + (1 * 2)) > 3)");
    expect(n("a - (b - c) > 0")).not.toBe(n("a - b - c > 0"));
  });

  it("reads NOT, !=, quoted identifiers and unary minus in PostgreSQL's spelling", () => {
    same(
      `"Weird Col" <> '' AND NOT n = 3`,
      `("Weird Col" <> ''::text) AND (NOT (n = 3))`
    );
    same(
      "s = 'a' OR s != 'b'",
      "((s)::text = 'a'::text) OR ((s)::text <> 'b'::text)"
    );
    same("-n < 3 AND n % 2 = 0", "((- n) < 3) AND ((n % 2) = 0)");
    same(`"status" IN ('a', 'b')`, "status IN ('a','b')");
  });

  it("keeps a quoted identifier whose case is significant", () => {
    expect(n(`"Status" = 'a'`)).not.toBe(n("status = 'a'"));
  });

  it("keeps a cast PostgreSQL would not have added", () => {
    // A cast to a character type is the server's; a cast to a number type on
    // a column is the author's and changes what is compared.
    expect(n("price::integer > 0")).not.toBe(n("price > 0"));
  });
});

// MySQL 8.0.46's CHECK_CLAUSE for the authored expression beside each, read on
// a utf8mb4 connection, with information_schema's extra escaping layer taken
// off the way introspection takes it off (`\'` to `'`, `\\` to `\`).
describe("normalizeCheckExpression — MySQL's spelling", () => {
  it("reads an enum check: backticks, introducers, lower-case keywords", () => {
    same("s IN ('a', 'b')", "(`s` in (_utf8mb4'a',_utf8mb4'b'))");
    same("s NOT IN ('a', 'b')", "(`s` not in (_utf8mb4'a',_utf8mb4'b'))");
    same(`s IN ('dq"x', 'nl')`, `(\`s\` in (_utf8mb4'dq"x',_utf8mb4'nl'))`);
  });

  it("reads a one-value set, which MySQL also stores as an equality", () => {
    same("s IN ('only')", "(`s` = _utf8mb4'only')");
  });

  it("reads a quote MySQL escapes with a backslash", () => {
    same("s IN ('it''s', 'x')", "(`s` in (_utf8mb4'it\\'s',_utf8mb4'x'))");
    // And reaches the same form as PostgreSQL's report of the same check.
    expect(n("(`s` in (_utf8mb4'it\\'s',_utf8mb4'x'))")).toBe(
      n(
        "((s)::text = ANY ((ARRAY['it''s'::character varying, 'x'::character varying])::text[]))"
      )
    );
  });

  it("compares a value holding a backslash as exact text", () => {
    // MySQL re-reads this clause under the sql_mode of whichever session
    // opens the table, so the same text enforces `back\slash` or `back\\slash`.
    // It must not be reported as matching either declaration.
    const reported = "(`s` in (_utf8mb4'back\\\\slash',_utf8mb4'q'))";
    expect(n(reported)).toBe(reported);
    expect(n(reported)).not.toBe(n("s IN ('back\\slash', 'q')"));
  });

  it("reads a hex literal behind an introducer as the text it encodes", () => {
    // How the enum helper writes a backslash value on MySQL.
    expect(n("s IN ('a', _utf8mb4 X'6261636B5C736C617368')")).toBe(
      n("s IN ('a', 'back\\slash')")
    );
    // Not valid UTF-8, so not a value this can name.
    expect(n("s = _utf8mb4 X'FF'")).toBe("s = _utf8mb4 X'FF'");
  });

  it("reads hand-written checks MySQL reshaped", () => {
    same(
      "n >= 0 AND (n IS NULL OR n < 1000)",
      "((`n` >= 0) and ((`n` is null) or (`n` < 1000)))"
    );
    same("n BETWEEN 1 AND 5", "(`n` between 1 and 5)");
    same(
      "t LIKE 'x%' AND length(t) > 2",
      "((`t` like _utf8mb4'x%') and (length(`t`) > 2))"
    );
    // MySQL stores `NOT n = 3` as `n <> 3`; PostgreSQL keeps `NOT (n = 3)`.
    same(
      "`Weird Col` <> '' AND NOT n = 3",
      "((`Weird Col` <> _utf8mb4'') and (`n` <> 3))"
    );
    same("n <> -5 AND -n < 3", "((`n` <> -(5)) and (-(`n`) < 3))");
    same("n IS NOT NULL", "(`n` is not null)");
  });

  it("still tells a different MySQL value set apart", () => {
    expect(n("(`s` in (_utf8mb4'a',_utf8mb4'b'))")).not.toBe(
      n("s IN ('a', 'b', 'c')")
    );
    expect(n("(`s` = _utf8mb4'only')")).not.toBe(n("s IN ('Only')"));
  });
});

describe("normalizeCheckExpression — NOT pushed into its predicate", () => {
  it("reads each negated predicate as its negated form", () => {
    same("n <> 3", "NOT (n = 3)");
    same("n >= 3", "NOT (n < 3)");
    same("n IS NOT NULL", "NOT (n IS NULL)");
    same("s NOT IN ('a', 'b')", "NOT (s IN ('a', 'b'))");
    same("t NOT LIKE 'x%'", "NOT (t LIKE 'x%')");
    same("n = 3", "NOT NOT n = 3");
  });

  it("does not invert what it cannot", () => {
    expect(n("NOT (a = 1 AND b = 1)")).not.toBe(n("a <> 1 AND b <> 1"));
  });
});

describe("normalizeCheckExpression — what it leaves alone", () => {
  it("returns an expression outside its grammar unchanged", () => {
    // `||` means OR in MySQL and concatenation in PostgreSQL, so it is not
    // guessed at: the text comes back as it went in and compares exactly as
    // it always did.
    expect(n("a || b = 'x'")).toBe("a || b = 'x'");
    expect(n("a) and (b")).toBe("a) and (b");
  });

  it("keeps a backslash in a plain literal as a character", () => {
    // What PostgreSQL and SQLite mean by it, and what the declared side says.
    expect(n("s = 'a\\b'")).toBe("s = 'a\\b'");
  });

  it("is idempotent", () => {
    const once = n(
      "((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))"
    );
    expect(n(once)).toBe(once);
  });

  it("changes nothing MySQL or SQLite would report differently in meaning", () => {
    // Keyword case and whitespace are all these dialects vary on for a check
    // that parses; string contents are never touched.
    same(
      "score >= 0 and (score is null or score < 1000)",
      "score >= 0 AND (score IS NULL OR score < 1000)"
    );
    expect(n("s = 'A'")).not.toBe(n("s = 'a'"));
    expect(n("s = ' a'")).not.toBe(n("s = 'a'"));
  });
});
