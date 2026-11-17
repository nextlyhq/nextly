/**
 * Which component writes count as a first publish as a header or footer.
 *
 * Every later publish of a header must not count (the default keeps the
 * first), and a component published first and marked as the header later
 * must count (a component made from a selection is created published).
 */
import { describe, expect, it } from "vitest";

import { firstPublishedAs } from "./first-fill-hook";

const live = (area: string | null) => ({
  id: "c1",
  status: "published",
  area,
});

describe("a component's first publish as a header or footer", () => {
  it("counts a create that publishes a header, naming who published it", () => {
    expect(
      firstPublishedAs({ data: live("header"), user: { id: "u1" } })
    ).toEqual({ id: "c1", area: "header", by: "u1" });
  });

  it("counts a draft's publish, and a published component newly marked as the footer", () => {
    expect(
      firstPublishedAs({
        data: live("footer"),
        originalData: { ...live("footer"), status: "draft" },
        user: { id: "u1" },
      })
    ).toEqual({ id: "c1", area: "footer", by: "u1" });
    expect(
      firstPublishedAs({
        data: live("footer"),
        originalData: live(null),
        user: { id: "u1" },
      })
    ).toEqual({ id: "c1", area: "footer", by: "u1" });
  });

  it("does not count a publish nobody made: a seed's, a script's", () => {
    expect(firstPublishedAs({ data: live("header") })).toBeNull();
    expect(firstPublishedAs({ data: live("header"), user: null })).toBeNull();
  });

  it("does not count a later publish of a header, a draft, a working draft or a component used anywhere", () => {
    expect(
      firstPublishedAs({
        data: live("header"),
        originalData: live("header"),
        user: { id: "u1" },
      })
    ).toBeNull();
    expect(
      firstPublishedAs({
        data: { ...live("header"), status: "draft" },
        user: { id: "u1" },
      })
    ).toBeNull();
    expect(
      firstPublishedAs({
        data: { ...live("header"), _isWorkingDraft: true },
        user: { id: "u1" },
      })
    ).toBeNull();
    expect(
      firstPublishedAs({ data: live(null), user: { id: "u1" } })
    ).toBeNull();
    expect(firstPublishedAs({ data: live(""), user: { id: "u1" } })).toBeNull();
  });
});
