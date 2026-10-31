/**
 * The dashboard header's summary parts, from what each source answered: the
 * attention digest's items, the releases due within the week, and a widget's
 * count.
 */
import { describe, expect, it } from "vitest";

import type { AttentionDigestItem } from "../../../domains/widgets/attention/digest-item";
import {
  attentionPart,
  releasesPart,
  RELEASES_WITHIN_DAYS,
  widgetPart,
} from "../header-summary";

describe("the attention part", () => {
  const OVERDUE = "releases?tab=attention&reason=overdue";
  const overdue: AttentionDigestItem = {
    id: "core/overdue-releases",
    kind: "overdue",
    label: "Overdue releases",
    count: 3,
    severity: "critical",
    link: OVERDUE,
  };
  const stopped: AttentionDigestItem = {
    id: "core/stopped-releases",
    kind: "stopped",
    label: "Releases that stopped",
    count: 2,
    severity: "critical",
    link: "releases?tab=attention&reason=stopped",
  };
  const plugin: AttentionDigestItem = {
    id: "acme/orders",
    kind: "plugin",
    label: "Orders to ship",
    count: 5,
    severity: "warning",
    link: "collections/orders",
  };

  it("counts the digest's items, the number the card's title shows, not their counts", () => {
    // Holding 3, 2 and 5: a part that summed them would say 10.
    expect(attentionPart([stopped, overdue, plugin])).toEqual({
      kind: "attention",
      count: 3,
      link: OVERDUE,
    });
  });

  it("is a floor when an item failed or its count is one", () => {
    expect(
      attentionPart([plugin, { ...stopped, count: 0, failed: true }])
    ).toEqual({ kind: "attention", count: 2, atLeast: true });
    expect(attentionPart([{ ...plugin, count: 99, atLeast: true }])).toEqual({
      kind: "attention",
      count: 1,
      atLeast: true,
    });
  });

  it("links to the overdue releases, by that item's own link, only when they were counted", () => {
    expect(attentionPart([stopped, plugin])).toEqual({
      kind: "attention",
      count: 2,
    });
    // Its count failed: nothing is known to be overdue, so the line does not
    // claim it by linking there.
    expect(attentionPart([{ ...overdue, count: 0, failed: true }])).toEqual({
      kind: "attention",
      count: 1,
      atLeast: true,
    });
  });

  it("has nothing to say when the digest holds no item", () => {
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
