/**
 * A field a caller may not READ is a field it may not GROUP BY.
 *
 * 🔴 The third disclosure route, and the one the `where` and `sort` guards do
 * not cover. Those leak a hidden value through which rows come back and through
 * where they land. Grouping leaks it more directly than either: the distinct
 * values BECOME the buckets, so a caller reads the whole value set off the
 * labels while field redaction strips the column from every row it never sees.
 *
 * Selecting the field is not required for that, which is why guarding `select`
 * would not help — the answer is the grouping, not the row.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../field-level-registry";
import { assertGroupableField } from "../filterable-fields";

const SLUG = "vaults";

/** A collection with one restricted field and one ordinary one. */
function registerVaults(): void {
  registerFieldFunctions("collection", SLUG, [
    { name: "codename", type: "text", access: { read: () => false } },
    { name: "region", type: "text" },
  ]);
}

afterEach(() => {
  clearFieldFunctions();
});

describe("grouping by a field that carries a read rule", () => {
  it("is REFUSED, naming the field and why", () => {
    // Asserted on the SERIALIZED error, not on `.message`:
    // `NextlyError.validation` carries a generic public message and puts the
    // per-field reason in its `errors` array, so a regex against the thrown
    // message would pass or fail for reasons unrelated to this guard.
    registerVaults();
    try {
      assertGroupableField("collection", SLUG, "codename");
      expect.unreachable("should have refused");
    } catch (error) {
      expect(JSON.stringify(error)).toMatch(/cannot be used to group/i);
      expect(JSON.stringify(error)).toContain("codename");
    }
  });

  it("reports it as NOT_GROUPABLE, not as an unsortable or unfilterable field", () => {
    // The three routes are different disclosures and a caller acting on the
    // refusal needs to know which one they hit.
    registerVaults();
    try {
      assertGroupableField("collection", SLUG, "codename");
      expect.unreachable("should have refused");
    } catch (error) {
      expect(JSON.stringify(error)).toContain("FIELD_NOT_GROUPABLE");
      expect(JSON.stringify(error)).toContain("groupBy.codename");
    }
  });

  it("CONTROL: an ordinary field groups freely", () => {
    registerVaults();
    expect(() =>
      assertGroupableField("collection", SLUG, "region")
    ).not.toThrow();
  });

  it("CONTROL: no group key is nothing to judge", () => {
    registerVaults();
    expect(() =>
      assertGroupableField("collection", SLUG, undefined)
    ).not.toThrow();
  });

  it("refuses a NULL key rather than reading it as no key at all", () => {
    // The seam this closes: every read that consumes this decision tests
    // `groupBy === undefined` for absence, so a `null` excused here was still a
    // key by the time it reached `toSnakeCase`, whose `.replace` threw a raw
    // `TypeError` the service reports as an unclassified 500 — the exact
    // outcome this validator exists to replace, arriving through the one value
    // it waved through.
    // Asserted on the SERIALIZED error for the reason the cases above are:
    // `NextlyError.validation` carries a generic public message and puts the
    // reason in `errors`.
    registerVaults();
    try {
      assertGroupableField("collection", SLUG, null as unknown as string);
      expect.unreachable("should have refused");
    } catch (error) {
      expect(JSON.stringify(error)).toMatch(/must be given as a string/i);
    }
  });

  it("refuses the other FALSY non-strings for the same reason", () => {
    // `0`, `false` and `NaN` are falsy AND wrong. A falsy test alone reads them
    // as absent, which is how they reached the crash.
    registerVaults();
    for (const bad of [0, false, Number.NaN]) {
      try {
        assertGroupableField("collection", SLUG, bad as unknown as string);
        expect.unreachable(`should have refused ${String(bad)}`);
      } catch (error) {
        expect(JSON.stringify(error)).toMatch(/must be given as a string/i);
      }
    }
  });

  it("judges the field that OWNS the rule for a nested path", () => {
    registerVaults();
    expect(() =>
      assertGroupableField("collection", SLUG, "codename.inner")
    ).toThrow();
  });

  it("a trusted caller has already decided who is asking", () => {
    registerVaults();
    expect(() =>
      assertGroupableField("collection", SLUG, "codename", {
        overrideAccess: true,
      })
    ).not.toThrow();
  });
});
