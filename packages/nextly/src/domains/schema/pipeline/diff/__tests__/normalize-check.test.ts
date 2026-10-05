// Tests for normalizeCheckExpression — the canonical form the diff compares
// check constraints in.
//
// The PostgreSQL inputs below are what `pg_get_constraintdef` returned on
// PostgreSQL 17 for the authored expression beside each, with the outer
// `CHECK (...)` removed the way introspection removes it. They are copied from
// the server rather than composed, because the whole point is that the
// server's spelling is not one anybody would write.

import { describe, expect, it } from "vitest";

import {
  normalizeCheckExpression as n,
  normalizeExpressionList,
} from "../normalize-check";

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

  it("keeps the quotes that make a reserved word a column", () => {
    // Recorded from PostgreSQL 17 for a table with a column named `user`:
    // CHECK ("user" IN ('a')) and CHECK (user IN ('a')). The second compares
    // CURRENT_USER, not the column, and the server says so by printing the
    // keyword bare and upper-case.
    const column = n(`("user" = ANY (ARRAY['a'::text, 'b'::text]))`);
    expect(column).toBe(n(`"user" IN ('a', 'b')`));
    expect(column).not.toBe(n("user IN ('a', 'b')"));
    expect(n("(USER = 'a'::name)")).toBe(n("user = 'a'::name"));
    expect(n("(USER = 'a'::name)")).not.toBe(n(`"user" = 'a'::name`));
    // MySQL backtick-quotes every column, and `order` is reserved on both.
    same("`order` IN ('x')", `"order" IN ('x')`);
    expect(n("`order` = 'x'")).not.toBe(n("order = 'x'"));
    // The canonical form still says what it means: bare `user` would read as
    // the keyword, so the column keeps its quotes in it.
    expect(n(`(("user")::text = 'a'::text)`)).toBe(`"user" = 'a'`);
  });

  it("drops quotes that change nothing, including around a non-reserved keyword", () => {
    // `position` is a keyword PostgreSQL still accepts as a column name, and
    // its deparser quotes it anyway: `("position" = ANY (...))` on PG 17.
    same(
      "position IN ('p', 'q')",
      `("position" = ANY (ARRAY['p'::text, 'q'::text]))`
    );
    same("`key` = 'k'", "key = 'k'");
  });

  it("keeps a cast PostgreSQL would not have added", () => {
    // A cast to a character type is the server's; a cast to a number type on
    // a column is the author's and changes what is compared.
    expect(n("price::integer > 0")).not.toBe(n("price > 0"));
  });

  it("keeps a sized or length-one character cast, which changes the value", () => {
    // `code` is char(3) and `s` is varchar(10); a sized cast truncates, so
    // each of these admits values the uncast comparison refuses.
    same(
      "code = 'A' OR code::char(1) = 'A'",
      "((code = 'A'::bpchar) OR ((code)::character(1) = 'A'::bpchar))"
    );
    expect(n("((code)::character(1) = 'A'::bpchar)")).not.toBe(n("code = 'A'"));
    same(
      "code::char = 'A' OR code::varchar(2) = 'AB' OR code = 'AB'::char",
      "(((code)::character(1) = 'A'::bpchar) OR (((code)::character varying(2))::text = 'AB'::text) OR (code = 'AB'::character(1)))"
    );
    expect(n("code = 'AB'::character(1)")).not.toBe(n("code = 'AB'"));
    expect(n("((code)::character varying(2))::text = 'AB'::text")).not.toBe(
      n("code = 'AB'")
    );
  });

  it("drops the unsized casts PostgreSQL inserts on a char(n) column", () => {
    same(
      "code IN ('A', 'B')",
      "(code = ANY (ARRAY['A'::bpchar, 'B'::bpchar]))"
    );
    same("code = 'A'", "(code = 'A'::bpchar)");
  });

  it("drops an unsized varchar cast, which is text by another name", () => {
    same(
      "s::character varying = 'a'",
      "(((s)::character varying)::text = 'a'::text)"
    );
    same("s::name = 'x'", "((s)::name = 'x'::name)");
    expect(n("s::name = 'x'")).not.toBe(n("s = 'x'"));
  });

  it("compares a kept cast by the type it names, not the alias used", () => {
    same(
      "n::int8 > 0 OR n::float8 > 1 OR n::decimal(5,2) > 1 OR n::int2 > 1 OR s::bool",
      "((((n)::bigint > 0) OR ((n)::double precision > (1)::double precision) OR ((n)::numeric(5,2) > (1)::numeric) OR ((n)::smallint > 1) OR (s)::boolean))"
    );
    same(
      "t::timestamp(2) > now() OR t::timestamptz(3) > now() OR n::float > 1 OR s::varchar(3)[] IS NULL",
      "((((t)::timestamp(2) without time zone > now()) OR ((t)::timestamp(3) with time zone > now()) OR ((n)::double precision > (1)::double precision) OR ((s)::character varying(3)[] IS NULL)))"
    );
    same(
      "t::time > now() OR t::timestamp > now()",
      "(((t)::time without time zone > now()) OR ((t)::timestamp without time zone > now()))"
    );
    // The size stays part of the type wherever PostgreSQL writes it.
    expect(n("t::timestamp(2) > now()")).not.toBe(n("t::timestamp > now()"));
    same(
      "s::int4 > 1 OR s::timestamptz > now()",
      "(((s)::integer > 1) OR ((s)::timestamp with time zone > now()))"
    );
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

describe("normalizeExpressionList — index expressions as the servers report them", () => {
  // Each pair is the key list as declared and as introspection reports it:
  // PostgreSQL 17 `pg_get_indexdef(indexrelid, key, false)` per key, and MySQL
  // 8.0.46 SHOW INDEX `Expression` per key, joined with ", " the way
  // introspection joins them. Recorded from the servers, not composed.
  const list = normalizeExpressionList;
  const sameIndex = (declared: string, reported: string): void => {
    expect(list(reported)).toBe(list(declared));
  };

  it("reads PostgreSQL's JSON accessors and concatenation", () => {
    sameIndex("data->>'x'", "((data ->> 'x'::text))");
    sameIndex("data->'a'->>'b'", "(((data -> 'a'::text) ->> 'b'::text))");
    sameIndex("data#>>'{a,b}'", "((data #>> '{a,b}'::text[]))");
    sameIndex("data#>'{a}'", "((data #> '{a}'::text[]))");
    sameIndex("data->>0", "((data ->> 0))");
    sameIndex("data ? 'k'", "((data ? 'k'::text))");
    sameIndex("status || 'x'", "((status || 'x'::text))");
    sameIndex("lower(email) || status", "((lower((email)::text) || status))");
    sameIndex("(data->>'n')::int", "(((data ->> 'n'::text))::integer)");
    sameIndex("lower(data->>'e')", "lower((data ->> 'e'::text))");
    sameIndex("coalesce(status, '')", "COALESCE(status, ''::text)");
    sameIndex("date_trunc('day', ts)", "date_trunc('day'::text, ts)");
  });

  it("compares a multi-key list key by key", () => {
    sameIndex("lower(email), status", "lower((email)::text), status");
    sameIndex("n + 1, n * 2", "((n + 1)), ((n * 2))");
    // MySQL, whose functional key parts are declared in parentheses.
    sameIndex("(lower(email)), status", "lower(`email`), status");
    sameIndex("(n + 1), (n * 2)", "(`n` + 1), (`n` * 2)");
  });

  it("reads MySQL's JSON calls and casts as the operators they were declared with", () => {
    sameIndex(
      "cast(data->>'$.x' as char(20))",
      "cast(json_unquote(json_extract(`data`,_utf8mb4'$.x')) as char(20) charset utf8mb4)"
    );
    sameIndex(
      "cast(data->'$.z' as char(10))",
      "cast(json_extract(`data`,_utf8mb4'$.z') as char(10) charset utf8mb4)"
    );
    sameIndex("concat(status, 'x')", "concat(`status`,_utf8mb4'x')");
    // A character set other than the default changes the value, so it stays.
    expect(list("cast(a as char(10) charset latin1)")).not.toBe(
      list("cast(a as char(10))")
    );
  });

  it("still tells different expressions apart", () => {
    expect(list("data->>'x'")).not.toBe(list("data->'x'"));
    expect(list("data->>'x'")).not.toBe(list("data->>'y'"));
    expect(list("lower(email), status")).not.toBe(list("status, lower(email)"));
    expect(list("a || b")).not.toBe(list("b || a"));
    // Precedence: the concatenation binds before the comparison.
    expect(list("a || b = c")).toBe(list("(a || b) = c"));
    expect(list("a || (b = c)")).not.toBe(list("a || b = c"));
  });

  it("keeps a key it cannot read as exact text, without disturbing the others", () => {
    // Unreadable keys never compare equal to a different spelling: loosening
    // the fallback is how two different indexes would come to match.
    expect(list("weird!!key, lower(email)")).toBe("weird!!key, lower(email)");
    expect(list("weird!!key, lower(email)")).toBe(
      list("weird!!key, lower((email)::text)")
    );
  });
});
