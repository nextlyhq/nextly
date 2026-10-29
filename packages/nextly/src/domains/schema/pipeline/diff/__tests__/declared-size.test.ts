import { describe, expect, it } from "vitest";

import { columnHolds, declaredSize, typesDiffer } from "../declared-size";
import type { ColumnSpec } from "../types";

const col = (over: Partial<ColumnSpec> & { type: string }): ColumnSpec => ({
  name: "amount",
  nullable: true,
  ...over,
});

/** How PostgreSQL introspection records a sized column: bare type, size aside. */
const live = (type: string, typeModifier?: string) =>
  col({ type, ...(typeModifier === undefined ? {} : { typeModifier }) });

/** How every desired-side declaration is authored: size inside the type. */
const desired = (type: string) => col({ type });

describe("declaredSize", () => {
  it("reads a size the type keeps beside it", () => {
    expect(declaredSize(live("numeric", "10,2"))).toBe("10,2");
  });

  it("reads a size the type spells inside itself", () => {
    expect(declaredSize(desired("varchar(255)"))).toBe("255");
  });

  it("reads the two spellings of one size identically", () => {
    // The desired side writes `numeric(10, 2)`; the live side yields `10,2`.
    // Any difference here is a change reported on every decimal column in
    // every PostgreSQL database.
    expect(declaredSize(desired("numeric(10, 2)"))).toBe(
      declaredSize(live("numeric", "10,2"))
    );
  });

  it("says nothing when the declaration states no size", () => {
    expect(declaredSize(desired("text"))).toBeUndefined();
  });
});

describe("typesDiffer - the change that used to go unseen", () => {
  it("sees a decimal narrowed on both precision and scale", () => {
    expect(typesDiffer(live("numeric", "10,2"), desired("numeric(5,1)"))).toBe(
      true
    );
  });

  it("sees a decimal narrowed on the scale alone", () => {
    // 19.99 becomes 20.0. The type NAME does not change, which is why the
    // token comparison reported nothing to do.
    expect(typesDiffer(live("numeric", "10,2"), desired("numeric(10,1)"))).toBe(
      true
    );
  });

  it("sees a varchar shortened", () => {
    expect(typesDiffer(live("varchar", "255"), desired("varchar(20)"))).toBe(
      true
    );
  });

  it("sees a decimal widened", () => {
    // Widening is still a change: the column has to be altered to hold more.
    expect(typesDiffer(live("numeric", "10,2"), desired("numeric(12,4)"))).toBe(
      true
    );
  });
});

describe("typesDiffer - changes that are not changes", () => {
  it("stays silent on the same size spelled two ways", () => {
    expect(
      typesDiffer(live("numeric", "10,2"), desired("numeric(10, 2)"))
    ).toBe(false);
  });

  it("stays silent when the desired side states no size", () => {
    // An existing column that is varchar(255) against a config asking for a
    // bare varchar is two descriptions at different levels of detail. Calling
    // it a resize emits an operation on every apply and never converges.
    expect(typesDiffer(live("varchar", "255"), desired("varchar"))).toBe(false);
  });

  it("stays silent when the live side states no size", () => {
    expect(typesDiffer(live("varchar"), desired("varchar(255)"))).toBe(false);
  });

  it("stays silent across the alias spellings of one type", () => {
    // The control this whole module is bounded by: `nextly migrate` must not
    // refuse an existing Postgres database over its own naming conventions.
    expect(typesDiffer(live("int4"), desired("integer"))).toBe(false);
    expect(typesDiffer(live("bool"), desired("boolean"))).toBe(false);
    expect(
      typesDiffer(live("timestamptz"), desired("timestamp with time zone"))
    ).toBe(false);
  });

  it("stays silent on MySQL's boolean, whose width IS the type", () => {
    // `tinyint(1)` collapses to the boolean token before any size is read. If
    // the size were compared here, every MySQL boolean would report a change.
    expect(typesDiffer(live("tinyint(1)", "1"), desired("boolean"))).toBe(
      false
    );
  });

  it("still sees a real type change", () => {
    expect(typesDiffer(live("numeric", "10,2"), desired("text"))).toBe(true);
  });
});

describe("columnHolds", () => {
  it("holds a declaration it matches, in either spelling of the size", () => {
    expect(
      columnHolds(live("numeric", "10,2"), desired("numeric(10, 2)"))
    ).toBe(true);
    expect(columnHolds(desired("varchar(255)"), desired("varchar(255)"))).toBe(
      true
    );
  });

  it("holds a shorter length, and not a longer one", () => {
    expect(columnHolds(live("varchar", "300"), desired("varchar(100)"))).toBe(
      true
    );
    expect(columnHolds(live("varchar", "50"), desired("varchar(100)"))).toBe(
      false
    );
  });

  it("holds a decimal only with as many digits on each side of the point", () => {
    expect(columnHolds(live("numeric", "12,2"), desired("numeric(10,2)"))).toBe(
      true
    );
    // More digits overall, fewer before the point: 99999999.99 does not fit numeric(10,4).
    expect(columnHolds(live("numeric", "10,4"), desired("numeric(10,2)"))).toBe(
      false
    );
    expect(columnHolds(live("numeric", "12,1"), desired("numeric(10,2)"))).toBe(
      false
    );
  });

  it("does not hold another type, whatever its size", () => {
    expect(columnHolds(live("int4"), desired("varchar(100)"))).toBe(false);
  });

  it("holds a narrower MySQL text type, and JSON in the LONGTEXT MariaDB reports for it", () => {
    expect(columnHolds(live("longtext"), desired("TEXT"))).toBe(true);
    expect(columnHolds(live("mediumtext"), desired("text"))).toBe(true);
    expect(columnHolds(live("longtext"), desired("JSON"))).toBe(true);
    expect(columnHolds(live("text"), desired("longtext"))).toBe(false);
    expect(columnHolds(live("text"), desired("JSON"))).toBe(false);
    expect(columnHolds(live("json"), desired("longtext"))).toBe(false);
  });

  it("does not hold a value NULL where the column refuses NULL", () => {
    expect(
      columnHolds(
        { ...live("varchar", "300"), nullable: false },
        desired("varchar(100)")
      )
    ).toBe(false);
  });

  it("lets no size decide where sizes are not enforced", () => {
    expect(
      columnHolds(live("numeric", "8,2"), desired("numeric(10,2)"), {
        sizes: false,
      })
    ).toBe(true);
    expect(
      columnHolds(live("int4"), desired("varchar(100)"), { sizes: false })
    ).toBe(false);
  });

  it("reads MySQL's bare datetime as no fractional seconds", () => {
    expect(columnHolds(desired("datetime"), desired("DATETIME(3)"))).toBe(
      false
    );
    expect(columnHolds(desired("datetime(3)"), desired("DATETIME(3)"))).toBe(
      true
    );
  });

  it("judges by type alone when either side states no size, as typesDiffer does", () => {
    expect(columnHolds(live("varchar"), desired("varchar(100)"))).toBe(true);
  });

  it("holds a size it cannot read as numbers only when the two are the same", () => {
    expect(columnHolds(live("enum", "'a','b'"), desired("enum('a','b')"))).toBe(
      true
    );
    expect(columnHolds(live("enum", "'a'"), desired("enum('a','b')"))).toBe(
      false
    );
  });
});
