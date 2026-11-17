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
      })
    ).toEqual({ id: "c1", area: "footer", by: null });
    expect(
      firstPublishedAs({ data: live("footer"), originalData: live(null) })
    ).toEqual({ id: "c1", area: "footer", by: null });
  });

  it("does not count a later publish of a header, a draft, a working draft or a component used anywhere", () => {
    expect(
      firstPublishedAs({ data: live("header"), originalData: live("header") })
    ).toBeNull();
    expect(
      firstPublishedAs({ data: { ...live("header"), status: "draft" } })
    ).toBeNull();
    expect(
      firstPublishedAs({ data: { ...live("header"), _isWorkingDraft: true } })
    ).toBeNull();
    expect(firstPublishedAs({ data: live(null) })).toBeNull();
    expect(firstPublishedAs({ data: live("") })).toBeNull();
  });
});
