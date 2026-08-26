import { describe, expect, it } from "vitest";

import { renamePreservation } from "./rename-preservation";

describe("renamePreservation", () => {
  it("reports the exact-to-float conversion the prompt called preserved", () => {
    // The defect this exists for. `numeric` and `float8` share the `decimal`
    // family, so compatibility said yes and both surfaces read that as "data
    // preserved" while 19.99 became 19.989999999999998.
    const answer = renamePreservation("numeric(10,2)", "float8", "postgresql");
    expect(answer.preserved).toBe(false);
    expect(answer.reason).toMatch(/binary float/);
  });

  it("reports the reverse, which rounds and can fail outright", () => {
    const answer = renamePreservation(
      "double precision",
      "numeric(10,2)",
      "postgresql"
    );
    expect(answer.preserved).toBe(false);
    expect(answer.reason).toMatch(/rounded|precision/);
  });

  it("reads precision and scale off both spellings", () => {
    // PostgreSQL introspection answers `float8` where the schema says
    // `double precision`, so a table keyed on one spelling would miss half
    // the pairs.
    for (const float of ["float8", "double precision", "real", "float4"]) {
      expect(
        renamePreservation("decimal(12,4)", float, "postgresql").preserved
      ).toBe(false);
    }
  });

  it("treats widening between floats as preserved and narrowing as not", () => {
    expect(renamePreservation("float4", "float8", "postgresql").preserved).toBe(
      true
    );
    expect(renamePreservation("float8", "float4", "postgresql").preserved).toBe(
      false
    );
    expect(
      renamePreservation("double precision", "real", "postgresql").preserved
    ).toBe(false);
  });

  it("says nothing changes when the type does not", () => {
    // Precision and scale are deliberately not read: a rename that keeps the
    // type is the ordinary case and must stay silent.
    expect(
      renamePreservation("numeric(10,2)", "numeric(10,2)", "postgresql")
        .preserved
    ).toBe(true);
    expect(renamePreservation("float8", "float8", "postgresql").preserved).toBe(
      true
    );
  });

  it("leaves pairs it knows nothing about as they were", () => {
    // Scope, asserted rather than described: this answers for numeric
    // exactness. Every other compatible pair keeps the answer it had before
    // this module existed, so adding it changed no other prompt.
    expect(
      renamePreservation("varchar(255)", "text", "postgresql").preserved
    ).toBe(true);
    expect(renamePreservation("int4", "int8", "postgresql").preserved).toBe(
      true
    );
    expect(renamePreservation("", "float8", "postgresql").preserved).toBe(true);
  });

  it("is not fooled by modifiers trailing the type", () => {
    expect(
      renamePreservation(
        "numeric(10,2) NOT NULL",
        "float8 DEFAULT 0",
        "postgresql"
      ).preserved
    ).toBe(false);
  });
});

describe("renamePreservation - an exact decimal narrowed against itself", () => {
  it("reports a narrower precision even though the type NAME does not change", () => {
    // `numeric(10,2) -> numeric(5,1)` reduces to `numeric` on both sides, so a
    // token comparison calls it unchanged. It is a real conversion: the
    // fraction is rounded and a value too large for the new precision fails
    // outright.
    const answer = renamePreservation(
      "numeric(10,2)",
      "numeric(5,1)",
      "postgresql"
    );
    expect(answer.preserved).toBe(false);
    expect(answer.reason).toMatch(/narrower/);
  });

  it("treats a widened declaration as preserved", () => {
    expect(
      renamePreservation("numeric(10,2)", "numeric(12,4)", "postgresql")
        .preserved
    ).toBe(true);
  });

  it("does not call it widened when the scale grows but the integer part shrinks", () => {
    // `numeric(10,2)` holds 8 digits before the point; `numeric(10,4)` holds 6.
    // Comparing scale alone — or precision alone — reads this as safe, and it
    // silently drops the two largest digits of every value.
    expect(
      renamePreservation("numeric(10,2)", "numeric(10,4)", "postgresql")
        .preserved
    ).toBe(false);
  });

  it("does not call it widened when the scale shrinks and the integer part grows", () => {
    // The mirror of the case above, and the one that separates a scale check
    // from an integer-part check: `numeric(10,2) -> numeric(10,1)` gains a
    // digit before the point and loses one after it, so 19.99 becomes 20.0.
    // Comparing the integer part alone reads this as safe.
    expect(
      renamePreservation("numeric(10,2)", "numeric(10,1)", "postgresql")
        .preserved
    ).toBe(false);
  });

  it("preserves a bounded decimal widened into an unconstrained one", () => {
    // A bare `numeric` has room for anything `numeric(5,1)` held.
    expect(
      renamePreservation("numeric(5,1)", "numeric", "postgresql").preserved
    ).toBe(true);
  });

  it("does NOT preserve an unconstrained decimal narrowed into a bounded one", () => {
    // The other direction of the same pair, and the opposite answer: a bare
    // `numeric` is the widest decimal there is, so constraining it rounds
    // every value to the new scale and fails on any too large for the new
    // precision.
    const answer = renamePreservation("numeric", "numeric(5,1)", "postgresql");
    expect(answer.preserved).toBe(false);
    expect(answer.reason).toContain("set no limit");
  });

  it("preserves a rename between two unconstrained decimals", () => {
    // Answered before the declarations are compared at all: the two spellings
    // normalise to one type, so the rename emits no conversion to rewrite.
    expect(
      renamePreservation("numeric", "decimal", "postgresql").preserved
    ).toBe(true);
  });
});

describe("renamePreservation - dialects that convert nothing", () => {
  it("says preserved on SQLite, where a rename emits no conversion at all", () => {
    // `conversionForRename` returns nothing for SQLite, so the column keeps
    // its name change and its storage classes. Warning that values change
    // there would deprioritise a candidate that is entirely safe.
    expect(
      renamePreservation("numeric(10,2)", "real", "sqlite").preserved
    ).toBe(true);
  });

  it("still reports the same pair on a dialect that DOES convert", () => {
    // The control: without it, "SQLite is preserved" passes just as well
    // against a function that stopped reporting anything.
    expect(
      renamePreservation("numeric(10,2)", "real", "postgresql").preserved
    ).toBe(false);
  });
});
