// Tests for normalizeDefault — the function that collapses semantically
// equivalent default-expression forms so the diff doesn't emit spurious
// change_column_default ops on every apply.
//
// Why this matters: PG's information_schema.column_default returns its
// canonical normalised form (e.g. `'draft'::character varying`), while
// the desired-side descriptor writes the human-authored form (e.g.
// `'draft'`). Without normalisation, every Builder apply emits a
// change_column_default op for every system column with a default,
// which blocks the fast-path emitter and routes the apply back to the
// slow drizzle-kit pushSchema.

import { describe, expect, it } from "vitest";

import { normalizeDefault } from "../normalize-default";

describe("normalizeDefault — PG redundant ::<type> cast stripping", () => {
  it("strips ::character varying from string literals", () => {
    // The single most common case: pgVarchar(...).default('draft') round-trips
    // through PG as 'draft'::character varying. The diff must treat the two
    // forms as equal.
    expect(normalizeDefault("'draft'::character varying")).toBe("draft");
  });

  it("strips ::text from string literals", () => {
    expect(normalizeDefault("'draft'::text")).toBe("draft");
  });

  it("strips ::bpchar (PG's underlying char type)", () => {
    expect(normalizeDefault("'X'::bpchar")).toBe("X");
  });

  it("strips ::integer from numeric literals", () => {
    expect(normalizeDefault("42::integer")).toBe("42");
  });

  it("strips ::numeric from numeric literals", () => {
    expect(normalizeDefault("0::numeric")).toBe("0");
  });

  it("strips ::bigint from numeric literals", () => {
    expect(normalizeDefault("0::bigint")).toBe("0");
  });

  it("strips ::boolean from true/false", () => {
    expect(normalizeDefault("true::boolean")).toBe("true");
    expect(normalizeDefault("false::boolean")).toBe("false");
  });

  it("does NOT strip ::type that appears INSIDE a string literal", () => {
    // The cast suffix must be at the end of the expression. A ::-looking
    // substring inside the quoted literal must not be touched.
    expect(normalizeDefault("'a::text inside'")).toBe("a::text inside");
  });

  it("preserves expressions with no cast suffix", () => {
    expect(normalizeDefault("'draft'")).toBe("draft");
    expect(normalizeDefault("42")).toBe("42");
    expect(normalizeDefault("now()")).toBe("now()");
  });
});

describe("normalizeDefault — string-literal unwrapping", () => {
  // The two sides of the diff quote a string default differently: the live
  // side reads the DDL (`'pending'`), the desired side reads the Drizzle
  // column, whose default is the JavaScript string (`pending`). Comparing
  // them unquoted is what makes them equal — otherwise every string-defaulted
  // column produces a change_column_default op on every diff, on every
  // dialect, and on SQLite the rebuild that follows drops the table's
  // indexes.
  it("reduces both sides of the same default to one form", () => {
    expect(normalizeDefault("'pending'")).toBe(normalizeDefault("pending"));
    expect(normalizeDefault("'ui'")).toBe(normalizeDefault("ui"));
    // PG reaches the same place from its cast form.
    expect(normalizeDefault("'draft'::text")).toBe(normalizeDefault("draft"));
  });

  it("unwraps an empty string literal", () => {
    expect(normalizeDefault("''")).toBe("");
  });

  it("leaves a literal containing a quote alone", () => {
    // PG and SQLite both escape by doubling, so an interior quote means the
    // contents cannot be recovered by removing the outer pair. Guessing here
    // would compare two different values equal, which is the one failure this
    // module must not have — so the expression is left exactly as found.
    expect(normalizeDefault("'it''s'")).toBe("'it''s'");
  });

  it("never equates a quoted literal with the expression it spells", () => {
    // The unwrap exists to make `'pending'` and `pending` compare equal. It
    // must not go on to make `'now()'` equal `now()`: the first is the word
    // stored in a text column, the second is evaluated per row. Equating them
    // reports a real default change as no change, and the column silently
    // keeps a default nobody chose.
    const distinct: Array<[string, string]> = [
      ["'now()'", "now()"],
      ["'CURRENT_TIMESTAMP'", "CURRENT_TIMESTAMP"],
      ["'true'", "true"],
      ["'false'", "false"],
      ["'null'", "null"],
      ["'0'", "0"],
      ["'42'", "42"],
      ["'-1'", "-1"],
      // Signs and a leading point are numeric too; only the minus form was
      // recognised, so `'+1'` reduced to the numeric expression it spells.
      ["'+1'", "+1"],
      ["'.5'", ".5"],
      ["'-.5'", "-.5"],
      ["'+.5'", "+.5"],
      ["'gen_random_uuid()'", "gen_random_uuid()"],
      // Parenthesised: SQLite requires the parens on an expression default,
      // so the quoted word must not reduce into the expression it spells.
      ["'(unixepoch())'", "(unixepoch())"],
      ["'(unixepoch())'", "unixepoch()"],
      // Bare-callable keywords: no parentheses, so the call-shape half of the
      // guard does not see them and each has to be named.
      ["'LOCALTIME'", "LOCALTIME"],
      ["'LOCALTIMESTAMP'", "LOCALTIMESTAMP"],
      ["'CURRENT_USER'", "CURRENT_USER"],
      ["'SESSION_USER'", "SESSION_USER"],
      ["'CURRENT_SCHEMA'", "CURRENT_SCHEMA"],
      ["'CURRENT_CATALOG'", "CURRENT_CATALOG"],
      ["'CURRENT_ROLE'", "CURRENT_ROLE"],
      ["'SYSTEM_USER'", "SYSTEM_USER"],
      ["'USER'", "USER"],
      ["'CURRENT_DATE'", "CURRENT_DATE"],
      ["'CURRENT_TIME'", "CURRENT_TIME"],
    ];
    for (const [literal, expression] of distinct) {
      expect(normalizeDefault(literal)).not.toBe(normalizeDefault(expression));
    }
  });

  it("still unwraps ordinary word defaults", () => {
    // The cases this was built for — every one of them a real column default
    // in the core schema.
    for (const word of ["pending", "ui", "draft", "template", "inside", "auto"])
      expect(normalizeDefault(`'${word}'`)).toBe(normalizeDefault(word));
  });

  it("collapses SQLite's wrapping parentheses to the form it reports back", () => {
    // SQLite will not take a bare call as a default — it must be written
    // `DEFAULT (unixepoch())` — and then PRAGMA table_info reports the column
    // as `unixepoch()`, without them. One side of the diff always carries a
    // pair the other never sees, so without this the column emits a default
    // change on every reconcile.
    expect(normalizeDefault("(unixepoch())")).toBe(
      normalizeDefault("unixepoch()")
    );
    expect(normalizeDefault("((now()))")).toBe(normalizeDefault("now()"));
  });

  it("leaves parentheses that do not wrap the whole expression", () => {
    // `(a) + (b)` opens and closes twice, so its first paren does not match
    // its last. Stripping would produce `a) + (b` — a different default, and
    // not valid SQL.
    expect(normalizeDefault("(a) + (b)")).toBe("(a) + (b)");
    expect(normalizeDefault("(a) || (b)")).toBe("(a) || (b)");
  });

  it("keeps whitespace that is part of a string default", () => {
    // A default of " pending " is not the default "pending". Trimming while
    // stripping parentheses collapsed the two, so a change between them would
    // have emitted no op and left the old default in the database.
    expect(normalizeDefault("' pending '")).toBe(" pending ");
    expect(normalizeDefault("' pending '")).not.toBe(
      normalizeDefault("pending")
    );
    // Whitespace beside a parenthesis is still insignificant.
    expect(normalizeDefault("( unixepoch() )")).toBe(
      normalizeDefault("unixepoch()")
    );
  });

  it("leaves unbalanced or unquoted expressions alone", () => {
    expect(normalizeDefault("'unterminated")).toBe("'unterminated");
    expect(normalizeDefault("gen_random_uuid()")).toBe("gen_random_uuid()");
    expect(normalizeDefault("'")).toBe("'");
  });
});

describe("normalizeDefault — function calls", () => {
  it("lowercases simple built-in function calls (defensive)", () => {
    // PG returns now() lowercase already, but normalising defensively means
    // the diff is robust if any code path ever emits NOW() or Now().
    expect(normalizeDefault("NOW()")).toBe("now()");
    expect(normalizeDefault("Now()")).toBe("now()");
  });

  it("leaves user-defined function calls (with arguments) unchanged", () => {
    // Don't aggressively lowercase — function names with arguments may carry
    // case-sensitive meaning depending on quoting. Only handle the no-arg
    // builtin case explicitly above.
    expect(normalizeDefault("gen_random_uuid()")).toBe("gen_random_uuid()");
    expect(normalizeDefault("md5('x')")).toBe("md5('x')");
  });
});

describe("normalizeDefault — keyword case", () => {
  it("treats a keyword default as the same value in any case", () => {
    // MySQL reports a DATETIME default as current_timestamp(3) where the
    // schema wrote CURRENT_TIMESTAMP(3); without this the bundled archive
    // table diffs its timestamp column on every reconcile.
    expect(normalizeDefault("CURRENT_TIMESTAMP(3)")).toBe(
      normalizeDefault("current_timestamp(3)")
    );
    expect(normalizeDefault("CURRENT_TIMESTAMP")).toBe(
      normalizeDefault("current_timestamp")
    );
    expect(normalizeDefault("LOCALTIMESTAMP(6)")).toBe(
      normalizeDefault("localtimestamp(6)")
    );
    expect(normalizeDefault("NOW()")).toBe(normalizeDefault("now()"));
  });

  it("leaves a user-defined function's case alone", () => {
    // Quoting decides whether MyFunc and myfunc are the same identifier, so
    // the collapse stays inside the keyword list.
    expect(normalizeDefault("MyFunc()")).not.toBe(normalizeDefault("myfunc()"));
  });
});

describe("normalizeDefault — passthrough behaviour", () => {
  it("returns undefined when input is undefined (no default)", () => {
    expect(normalizeDefault(undefined)).toBeUndefined();
  });

  it("returns the input unchanged for unrecognised expressions", () => {
    // Bounded risk: if we don't recognise the shape, pass it through. The
    // diff will then catch any real default change — better a false-positive
    // change_column_default than silently swallowing a real one.
    expect(normalizeDefault("some_unknown_expr(1,2)")).toBe(
      "some_unknown_expr(1,2)"
    );
    // Keywords normalise to lower case, because the dialects report them back
    // in whatever case they choose. Non-keyword expressions still pass through
    // untouched, which is what this case is really guarding.
    expect(normalizeDefault("MyFunc()")).toBe("MyFunc()");
  });
});

/**
 * MySQL reports defaults for the schema this project itself writes in forms
 * the desired side never spells that way, which made the core reconciler emit
 * a default change for every timestamp and boolean column — so `nextly
 * migrate` applied once and then refused to run again against its own output.
 */
describe("normalizeDefault — MySQL equivalences", () => {
  it("treats current_timestamp and now() as the same default", () => {
    expect(normalizeDefault("CURRENT_TIMESTAMP")).toBe(
      normalizeDefault("now()")
    );
    expect(normalizeDefault("current_timestamp")).toBe("now()");
  });

  it("carries a precision argument across the collapse", () => {
    // A DATETIME(3) column authored `CURRENT_TIMESTAMP(3)` reads back from
    // MySQL as `now(3)`.
    expect(normalizeDefault("CURRENT_TIMESTAMP(3)")).toBe(
      normalizeDefault("now(3)")
    );
    // Precision is part of the value, so it is not discarded: a column
    // defaulting to whole seconds is not the same as one keeping millis.
    expect(normalizeDefault("current_timestamp(3)")).not.toBe(
      normalizeDefault("now()")
    );
  });

  it("ignores whitespace inside the call", () => {
    // Insignificant to every dialect, but not to the string compare the diff
    // performs, so a hand-written spacing must reduce to the same token.
    for (const spelling of [
      "CURRENT_TIMESTAMP ( 3 )",
      "current_timestamp(3 )",
      "current_timestamp (3)",
    ]) {
      expect(normalizeDefault(spelling), spelling).toBe(
        normalizeDefault("now(3)")
      );
    }
    expect(normalizeDefault("now ( 3 )")).toBe(normalizeDefault("now(3)"));
  });

  it("treats a no-argument call as the bare keyword", () => {
    // MySQL accepts `CURRENT_TIMESTAMP()`, which denotes exactly what the
    // bare keyword does.
    expect(normalizeDefault("CURRENT_TIMESTAMP()")).toBe(
      normalizeDefault("now()")
    );
    expect(normalizeDefault("current_timestamp( )")).toBe("now()");
  });

  it("leaves a bare `now` alone", () => {
    // Not callable without parentheses in any supported dialect, so an
    // expression spelling it that way denotes something else.
    expect(normalizeDefault("now")).toBe("now");
  });

  it("reads 1 and 0 as booleans on a boolean column", () => {
    // MySQL booleans ARE tinyint(1), so a boolean default comes back as 1/0
    // where the schema authored true/false.
    expect(normalizeDefault("1", "tinyint(1)")).toBe(
      normalizeDefault("true", "boolean")
    );
    expect(normalizeDefault("0", "tinyint(1)")).toBe(
      normalizeDefault("false", "boolean")
    );
  });

  it("does not read 1 as a boolean on an integer column", () => {
    // The whole point of passing the type: on an int column `1` is the
    // number, and collapsing it would hide a real default change.
    expect(normalizeDefault("1", "int")).not.toBe(
      normalizeDefault("true", "boolean")
    );
    expect(normalizeDefault("1", "int")).toBe("1");
  });

  it("still normalises a boolean default when no type is supplied", () => {
    // Without a type the literal is left alone rather than guessed at.
    expect(normalizeDefault("1")).toBe("1");
  });
});
