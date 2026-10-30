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
  const OVERDUE = "releases?tab=attention&reason=overdue";

  it("counts each kind's total from the card's grouped answer, never its parts as well", () => {
    expect(
      attentionPart(
        [
          { value: "unpublished", count: 3 },
          { value: "unpublished:collection:posts", count: 3 },
          { value: "scheduled", count: 2 },
          { value: "scheduled:collection:posts", count: 2 },
        ],
        OVERDUE
      )
    ).toEqual({ kind: "attention", count: 5 });
    expect(
      attentionPart(
        [
          { value: "unpublished", count: 99, atLeast: true },
          { value: "overdue", count: 3 },
        ],
        OVERDUE
      )
    ).toEqual({ kind: "attention", count: 102, atLeast: true, link: OVERDUE });
  });

  it("links to the overdue releases only when some are waiting", () => {
    expect(
      attentionPart(
        [
          { value: "unpublished", count: 4 },
          { value: "overdue", count: 1 },
        ],
        OVERDUE
      )
    ).toEqual({ kind: "attention", count: 5, link: OVERDUE });
    expect(
      attentionPart([{ value: "unpublished", count: 4 }], OVERDUE)
    ).toEqual({ kind: "attention", count: 4 });
  });

  it("fails when nothing was found but some lists went unread, as the card says Not all checked", () => {
    expect(
      attentionPart(
        [{ value: "unpublished", count: 0, atLeast: true }],
        OVERDUE
      )
    ).toBe("failed");
  });

  it("has nothing to say when nothing is waiting", () => {
    expect(attentionPart([], OVERDUE)).toBeNull();
    expect(attentionPart([{ value: "overdue", count: 0 }], OVERDUE)).toBeNull();
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
