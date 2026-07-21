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
    expect(normalizeDefault("CURRENT_TIMESTAMP")).toBe("CURRENT_TIMESTAMP");
  });
});
