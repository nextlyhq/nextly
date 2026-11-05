/**
 * A filter, sort or group key naming a field a read leaves out is refused,
 * in the spelling a query uses. A dynamic zone's member type is a `#type`
 * segment in the declared path that no query spells, so it is matched without
 * it: `zone.#cta.secret` is queried as `zone.secret`.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { assertNoHiddenFieldQueried } from "../filterable-fields";

/** The paths a refusal names, or none when the query passes. */
function refusedPaths(run: () => void): string[] {
  try {
    run();
    return [];
  } catch (error) {
    if (!NextlyError.isCode(error, "VALIDATION_ERROR")) throw error;
    const data = error.publicData as { errors?: { path: string }[] };
    return (data.errors ?? []).map(entry => entry.path);
  }
}

describe("a query naming a hidden field", () => {
  const hidden = new Set(["zone.#cta.secret", "internalCode"]);

  it("is refused for a dynamic zone member's field, spelled as a query spells it", () => {
    expect(
      refusedPaths(() =>
        assertNoHiddenFieldQueried(
          { where: { "zone.secret": { equals: "x" } } },
          hidden
        )
      )
    ).toEqual(["where.zone.secret"]);
  });

  it("is refused in a snake_case spelling, and reported where the caller named it", () => {
    expect(
      refusedPaths(() =>
        assertNoHiddenFieldQueried(
          { groupBy: "internal_code", groupByAt: "dateField" },
          hidden
        )
      )
    ).toEqual(["dateField.internal_code"]);
  });

  it("passes a visible field and a zone field that is not hidden", () => {
    expect(
      refusedPaths(() =>
        assertNoHiddenFieldQueried(
          { where: { "zone.title": { equals: "x" }, title: { equals: "y" } } },
          hidden
        )
      )
    ).toEqual([]);
  });
});
