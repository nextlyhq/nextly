/**
 * The dashboard header's summary parts, from what each source answered: the
 * attention total, the releases due within the week, and a widget's count.
 */
import { describe, expect, it } from "vitest";

import {
  attentionPart,
  releasesPart,
  RELEASES_WITHIN_DAYS,
  widgetPart,
} from "../header-summary";

describe("the attention part", () => {
  it("sums the items' counts, a floor when any item's count is one", () => {
    expect(attentionPart([{ count: 3 }, { count: 2 }])).toEqual({
      kind: "attention",
      count: 5,
    });
    expect(attentionPart([{ count: 3 }, { count: 99, atLeast: true }])).toEqual(
      { kind: "attention", count: 102, atLeast: true }
    );
  });

  it("links to the most urgent item, the digest's first", () => {
    expect(
      attentionPart([
        { count: 1, link: "releases/r1" },
        { count: 4, link: "collections/posts" },
      ])
    ).toEqual({ kind: "attention", count: 5, link: "releases/r1" });
  });

  it("fails as a whole when any item failed, so the total never leaves one out", () => {
    expect(attentionPart([{ count: 3 }, { count: 0, failed: true }])).toBe(
      "failed"
    );
  });

  it("has nothing to say when nothing is waiting", () => {
    expect(attentionPart([])).toBeNull();
  });
});

describe("the releases part", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");
  const inDays = (days: number) =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  it("counts the releases due within the week, naming the soonest", () => {
    expect(
      releasesPart(
        [
          { scheduledAt: inDays(2) },
          { scheduledAt: inDays(0.5) },
          { scheduledAt: inDays(RELEASES_WITHIN_DAYS + 1) },
        ],
        now,
        10
      )
    ).toEqual({ kind: "releases", count: 2, nearest: inDays(0.5) });
  });

  it("leaves out a release already past and a date that is not one", () => {
    expect(
      releasesPart(
        [{ scheduledAt: inDays(-1) }, { scheduledAt: "soon" }, {}],
        now,
        10
      )
    ).toBeNull();
  });

  it("is a floor when the source answered as many rows as asked, every one within the week", () => {
    const rows = [{ scheduledAt: inDays(1) }, { scheduledAt: inDays(3) }];
    expect(releasesPart(rows, now, 2)).toMatchObject({
      count: 2,
      atLeast: true,
    });
    // One row past the week shows the source ran out of releases due within it.
    expect(
      releasesPart([...rows, { scheduledAt: inDays(9) }], now, 3)
    ).not.toHaveProperty("atLeast");
  });
});

describe("a widget's part", () => {
  it("is the widget's count under its label, on its card", () => {
    expect(widgetPart("acme/forms", "card-1", "new submissions", 4)).toEqual({
      kind: "widget",
      widget: "acme/forms",
      card: "card-1",
      label: "new submissions",
      count: 4,
    });
  });

  it("has nothing to say for no count, a negative one or one that is not a number", () => {
    for (const count of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(widgetPart("acme/forms", "card-1", "new", count)).toBeNull();
    }
  });
});
