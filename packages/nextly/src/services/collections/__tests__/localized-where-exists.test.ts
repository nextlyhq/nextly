/**
 * Every operator the where translator can emit has to be expressible against a
 * companion table.
 *
 * A filter on a localized field is resolved by `buildLocalizedWhereExists`
 * before the column lookup, and the column lookup cannot resolve such a field —
 * it has no column on the main table. So an operator this returns `undefined`
 * for is not approximated or refused, it is DROPPED: the member disappears and
 * its siblings decide alone. For a caller's own filter that is merely wrong; for
 * an access constraint it means the read runs under a weaker predicate than the
 * rule states.
 *
 * Nothing in the type system ties the two sets together, so this asserts it.
 * Adding an operator to the where translator without adding it here should fail
 * this test rather than silently widen a localized access rule.
 */
import { describe, expect, it } from "vitest";

import {
  buildWhereClause,
  getSupportedOperators,
  type WhereFilter,
} from "../../../domains/collections/query/query-operators";
import {
  buildLocalizedWhereExists,
  type LocalizedQueryContext,
} from "../drizzle-condition";

const CTX: LocalizedQueryContext = {
  companionTableName: "dc_pages_locales",
  localizedFields: [{ name: "region", column: "region" }],
  // Only interpolated into the emitted SQL, never inspected here.
  mainIdColumn: "id",
  locale: "en",
};

/**
 * A value each operator accepts, so the translator emits a condition rather
 * than skipping the member for an unusable value.
 */
function sampleValue(operator: string): unknown {
  if (operator === "in" || operator === "not_in") return ["emea"];
  if (operator === "exists") return true;
  return "emea";
}

/** The internal operators `buildWhereClause` produces for the public set. */
function internalOperators(): {
  operator: string;
  op: string;
  value: unknown;
}[] {
  return getSupportedOperators().map(operator => {
    const value = sampleValue(operator);
    const clause = buildWhereClause({
      region: { [operator]: value },
    } as WhereFilter);
    const condition = clause?.and?.[0] as
      | { op: string; value: unknown }
      | undefined;
    expect(
      condition,
      `buildWhereClause emitted nothing for "${operator}"`
    ).toBeDefined();
    return { operator, op: condition!.op, value: condition!.value };
  });
}

describe("localized companion filters cover every translated operator", () => {
  it.each(internalOperators())(
    'expresses "$operator" ($op) against the companion table',
    ({ operator, op, value }) => {
      const condition = buildLocalizedWhereExists(
        CTX,
        "region",
        op,
        value,
        "postgresql"
      );

      expect(
        condition,
        `operator "${operator}" translates to "${op}", which has no companion ` +
          `form — a filter using it on a localized field would be dropped`
      ).toBeDefined();
    }
  );

  it("returns nothing for an operator it does not know", () => {
    // The other half of the contract: an unrecognized operator must come back
    // empty so the caller's own untranslatable check can refuse it, rather than
    // being turned into some nearby condition.
    expect(
      buildLocalizedWhereExists(CTX, "region", "BETWEEN", [1, 2], "postgresql")
    ).toBeUndefined();
  });

  it("constrains the companion row by locale", () => {
    const condition = buildLocalizedWhereExists(
      CTX,
      "region",
      "=",
      "emea",
      "postgresql"
    );

    // The locale has to reach the subquery: without it the filter matches a
    // value in ANY language, which for an access rule admits rows on the
    // strength of a translation the caller never asked for.
    expect(condition!.queryChunks.length).toBeGreaterThan(0);
    expect(JSON.stringify(condition)).toContain("_locale");
  });

  it("filters an untranslated field with NOT EXISTS rather than a null compare", () => {
    // A field with no translation for the locale usually has no companion row at
    // all, so `EXISTS(col IS NULL)` would match nothing and quietly exclude
    // every untranslated row.
    const condition = buildLocalizedWhereExists(
      CTX,
      "region",
      "IS NULL",
      null,
      "postgresql"
    );

    expect(JSON.stringify(condition)).toContain("NOT");
  });
});
