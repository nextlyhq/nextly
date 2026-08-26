import { describe, expect, it } from "vitest";

import { renamePreservation } from "./rename-preservation";

describe("renamePreservation", () => {
  it("reports the exact-to-float conversion the prompt called preserved", () => {
    // The defect this exists for. `numeric` and `float8` share the `decimal`
    // family, so compatibility said yes and both surfaces read that as "data
    // preserved" while 19.99 became 19.989999999999998.
    const answer = renamePreservation("numeric(10,2)", "float8");
    expect(answer.preserved).toBe(false);
    expect(answer.reason).toMatch(/binary float/);
  });

  it("reports the reverse, which rounds and can fail outright", () => {
    const answer = renamePreservation("double precision", "numeric(10,2)");
    expect(answer.preserved).toBe(false);
    expect(answer.reason).toMatch(/rounded|precision/);
  });

  it("reads precision and scale off both spellings", () => {
    // PostgreSQL introspection answers `float8` where the schema says
    // `double precision`, so a table keyed on one spelling would miss half
    // the pairs.
    for (const float of ["float8", "double precision", "real", "float4"]) {
      expect(renamePreservation("decimal(12,4)", float).preserved).toBe(false);
    }
  });

  it("treats widening between floats as preserved and narrowing as not", () => {
    expect(renamePreservation("float4", "float8").preserved).toBe(true);
    expect(renamePreservation("float8", "float4").preserved).toBe(false);
    expect(renamePreservation("double precision", "real").preserved).toBe(
      false
    );
  });

  it("says nothing changes when the type does not", () => {
    // Precision and scale are deliberately not read: a rename that keeps the
    // type is the ordinary case and must stay silent.
    expect(renamePreservation("numeric(10,2)", "numeric(10,2)").preserved).toBe(
      true
    );
    expect(renamePreservation("float8", "float8").preserved).toBe(true);
  });

  it("leaves pairs it knows nothing about as they were", () => {
    // Scope, asserted rather than described: this answers for numeric
    // exactness. Every other compatible pair keeps the answer it had before
    // this module existed, so adding it changed no other prompt.
    expect(renamePreservation("varchar(255)", "text").preserved).toBe(true);
    expect(renamePreservation("int4", "int8").preserved).toBe(true);
    expect(renamePreservation("", "float8").preserved).toBe(true);
  });

  it("is not fooled by modifiers trailing the type", () => {
    expect(
      renamePreservation("numeric(10,2) NOT NULL", "float8 DEFAULT 0").preserved
    ).toBe(false);
  });
});
