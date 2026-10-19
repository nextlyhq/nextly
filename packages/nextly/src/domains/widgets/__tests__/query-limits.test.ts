/**
 * The row count a widget query asks for, as the server will run it.
 *
 * One rule for both sides: the query validator bounds the limit with it, and
 * the admin reserves a list card's rows with it before any data arrives. A
 * second copy in the browser would reserve 5 rows for a query the server runs
 * at 50 the day the two disagreed.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { validateWidgetQuery } from "../query";
import {
  DEFAULT_WIDGET_LIMIT,
  MAX_WIDGET_LIMIT,
  effectiveWidgetLimit,
} from "../query-limits";
import { clearSources, registerSource } from "../sources";

beforeEach(() => {
  clearSources();
  registerSource({
    id: "collection:posts",
    label: "Posts",
    kind: "collection",
    supports: ["count", "list"],
    fields: [{ name: "title", type: "string" }],
  });
});

describe("effectiveWidgetLimit", () => {
  it("takes the default when no usable limit is declared", () => {
    for (const limit of [undefined, null, "10", Number.NaN, Infinity]) {
      expect(effectiveWidgetLimit(limit)).toBe(DEFAULT_WIDGET_LIMIT);
    }
  });

  it("bounds a declared limit to one and the maximum, in whole rows", () => {
    expect(effectiveWidgetLimit(0)).toBe(1);
    expect(effectiveWidgetLimit(-3)).toBe(1);
    expect(effectiveWidgetLimit(12)).toBe(12);
    expect(effectiveWidgetLimit(12.9)).toBe(12);
    expect(effectiveWidgetLimit(MAX_WIDGET_LIMIT + 30)).toBe(MAX_WIDGET_LIMIT);
  });

  it("is the limit the validator runs a query at", () => {
    // 🔴 The separating case for a second implementation: whatever the
    // validator does to a limit, this answers the same.
    for (const limit of [undefined, 0, 7, 12.9, 500]) {
      const query = validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        ...(limit === undefined ? {} : { limit }),
      });
      expect(query.limit).toBe(effectiveWidgetLimit(limit));
    }
  });
});
