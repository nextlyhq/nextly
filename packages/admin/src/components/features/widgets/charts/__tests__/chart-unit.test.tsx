/**
 * What a chart's numbers count: written after each number in its tooltip ("12 new posts"), from
 * the collection's label as published to this reader, singular for one.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCollectionUnit, withUnit } from "../chart-unit";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({
    widgetSources: [
      { collection: "posts", label: "Blog Posts" },
      { collection: "faqs", label: "FAQ Entries" },
    ],
  }),
}));

/** The unit a card reading `collection` hands its chart, written as "one / other". */
function unitOf(collection: string | undefined, qualifier?: string): string {
  // The hook a core card calls with the collection its settings name.
  const { result } = renderHook(() => useCollectionUnit(collection, qualifier));
  const unit = result.current;
  return unit ? `${unit.one} / ${unit.other}` : "none";
}

describe("a chart's unit", () => {
  it("writes a number with its noun, singular for one", () => {
    const unit = { one: "new post", other: "new posts" };
    expect(withUnit("12", 12, unit)).toBe("12 new posts");
    expect(withUnit("1", 1, unit)).toBe("1 new post");
    expect(withUnit("0", 0, unit)).toBe("0 new posts");
  });

  it("writes a floor as drawn, with its noun", () => {
    expect(withUnit("2,000+", 2000, { one: "post", other: "posts" })).toBe(
      "2,000+ posts"
    );
  });

  it("writes a number bare where the chart was given no unit", () => {
    expect(withUnit("12", 12, undefined)).toBe("12");
  });

  it("is the collection's label as a noun, lowercased word by word", () => {
    expect(unitOf("posts", "new")).toBe("new blog post / new blog posts");
  });

  it("keeps an acronym in the label as it is written", () => {
    expect(unitOf("faqs")).toBe("FAQ entry / FAQ entries");
  });

  it("is none for a card that reads no one collection", () => {
    expect(unitOf(undefined)).toBe("none");
  });
});
