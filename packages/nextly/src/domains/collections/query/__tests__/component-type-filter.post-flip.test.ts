/**
 * A caller's type filter keeps selecting on the type after the storage rename.
 *
 * The discriminator path in a `where` clause is supplied by the CALLER, not by this codebase, so
 * it may name any spelling the key has carried since the query was written. Matching a single
 * spelling does not make such a filter fail — it silently reclassifies it as an ordinary component
 * field lookup, which then searches for a column of that name. The caller gets rows back, so
 * nothing surfaces as an error; they are simply the wrong rows.
 *
 * 🔴 Invisible before the rename, like the other suites of this shape: while the catalog still
 * holds the legacy spelling, matching one spelling and matching all of them agree on every input,
 * so a test written against today's catalog passes either way. The catalog is mocked forward.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../schemas/storage-format", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../schemas/storage-format")
  >("../../../../schemas/storage-format");
  return {
    ...actual,
    STORAGE_FORMAT: {
      ...actual.STORAGE_FORMAT,
      wireTypeKey: "_fieldGroupType",
    },
  };
});

import { currentFieldGroupTypeKey } from "../../../field-groups/storage/field-group-type-key";
import { extractComponentFieldConditions } from "../query-operators";

const fields = [
  { name: "seo", type: "component", component: "seo" },
  { name: "layout", type: "component", components: ["hero", "cta"] },
];

describe("a type filter written before the storage rename", () => {
  it("the catalog really has moved, or this file proves nothing", () => {
    expect(currentFieldGroupTypeKey).toBe("_fieldGroupType");
  });

  it("is still recognised as a type filter under the LEGACY spelling", () => {
    const { componentFilters } = extractComponentFieldConditions(
      { "layout._componentType": { equals: "hero" } },
      fields
    );

    expect(componentFilters).toHaveLength(1);
    // The separating assertion. Matching one spelling leaves this false, and the filter is then
    // handled as a lookup for a column literally named `_componentType`.
    expect(componentFilters[0].isComponentTypeFilter).toBe(true);
  });

  it("is recognised under the new spelling too", () => {
    const { componentFilters } = extractComponentFieldConditions(
      { "layout._fieldGroupType": { equals: "hero" } },
      fields
    );

    expect(componentFilters[0].isComponentTypeFilter).toBe(true);
  });

  it("recognises the legacy spelling in the shorthand equality form as well", () => {
    // Two call sites decide this, one per `where` syntax. Covering only the operator form leaves
    // the shorthand able to regress on its own.
    const { componentFilters } = extractComponentFieldConditions(
      { "layout._componentType": "hero" },
      fields
    );

    expect(componentFilters[0].isComponentTypeFilter).toBe(true);
  });

  it("still treats an ordinary component field as NOT a type filter", () => {
    // The dual match widens which spellings count as the discriminator, not what counts as one.
    const { componentFilters } = extractComponentFieldConditions(
      { "seo.metaTitle": { contains: "About" } },
      fields
    );

    expect(componentFilters[0].isComponentTypeFilter).toBe(false);
  });
});
