/**
 * A past version's values are read over every field the type declares, even
 * where a plugin's switch keeps some of them out of the drawn layout: a field
 * the editor still shows can be conditioned on one it no longer draws, and
 * that condition must be judged on the value the version stored.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";
import type { FieldConfig } from "nextly/config";

import { useViewedVersion } from "../viewed-version-host";

const featured = { name: "featured", type: "checkbox" } as FieldConfig;
const banner = {
  name: "banner",
  type: "text",
  admin: { condition: { field: "featured", equals: true } },
} as unknown as FieldConfig;
const title = { name: "title", type: "text" } as FieldConfig;

const version: ViewedVersion = {
  versionNo: 2,
  snapshot: { title: "as it was", featured: true, banner: "Spring sale" },
  locale: null,
  withheld: [],
  isLoading: false,
  error: null,
  scope: { kind: "collection", slug: "posts", entryId: "e1" },
  comparedWith: { kind: "first" },
  about: null,
};

describe("useViewedVersion — values over every declared field", () => {
  it("keeps a withheld controller's stored value while drawing it nowhere", () => {
    const drawn = [title, banner];
    const declared = [title, featured, banner];
    const { result } = renderHook(() =>
      useViewedVersion(drawn, [], undefined, undefined, declared)
    );
    act(() => result.current.documentHistory.setViewing(version));

    expect(result.current.historicalValues).toMatchObject({
      featured: true,
      banner: "Spring sale",
    });
    const drawnNames = result.current.historicalFields?.map(f => f.name);
    expect(drawnNames).toContain("banner");
    expect(drawnNames).not.toContain("featured");
  });

  it("reads values over the drawn fields when no wider list is given", () => {
    const { result } = renderHook(() => useViewedVersion([title], []));
    act(() => result.current.documentHistory.setViewing(version));

    expect(Object.keys(result.current.historicalValues ?? {})).toEqual([
      "title",
    ]);
  });
});
