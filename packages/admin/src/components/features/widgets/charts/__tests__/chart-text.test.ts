/**
 * What a chart says: its name, the current point, its text alternative, and
 * whether its latest point is circled and labelled.
 *
 * Numbers arrive formatted, by the same formatter the table uses, so the
 * words and the table agree; these functions decide only which figures are
 * said and how they are put together. "Most", never "largest": and where the
 * counts are floors, not even "most", because a bounded count cannot rank the
 * groups it never reached.
 */
import { describe, expect, it } from "vitest";

import {
  chartName,
  currentPointText,
  groupsSummary,
  latestMarker,
  overTimeFigures,
  overTimeSummary,
} from "../chart-text";

/** A stand-in for the card formatter's spoken label. */
const say = (n: number) => n.toLocaleString("en-US");

describe("the chart's name", () => {
  it("says what it shows and its range, and how to read it", () => {
    expect(
      chartName({
        kind: "points",
        what: "Posts created",
        range: "last 30 days",
      })
    ).toBe(
      "Posts created, last 30 days. Use the arrow keys to read each point."
    );
    expect(chartName({ kind: "bars", what: "Posts by status" })).toBe(
      "Posts by status. Use the arrow keys to read each bar."
    );
  });
});

describe("the current point, read politely as the keys move", () => {
  const at = (index: number, of: number) => ({ index, of });

  it("says when, how many, and where it sits", () => {
    expect(
      currentPointText({ when: "Oct 14", value: "12", position: at(2, 7) })
    ).toBe("Oct 14: 12. 3 of 7.");
  });

  it("names the series where there are several", () => {
    expect(
      currentPointText({
        series: "Pages",
        when: "Oct 14",
        value: "3",
        position: at(0, 7),
      })
    ).toBe("Pages, Oct 14: 3. 1 of 7.");
  });

  it("says a bar's group and its count, a floor as it is spoken", () => {
    expect(
      currentPointText({
        when: "Draft",
        value: "100 or more",
        position: at(1, 3),
      })
    ).toBe("Draft: 100 or more. 2 of 3.");
  });

  it("reads two points that look alike differently, by where they sit", () => {
    const one = currentPointText({
      when: "Done",
      value: "4",
      position: at(0, 2),
    });
    const two = currentPointText({
      when: "Done",
      value: "4",
      position: at(1, 2),
    });
    expect(one).not.toBe(two);
  });
});

describe("the figures an over-time summary states", () => {
  const points = [
    { when: "Oct 10", value: 4 },
    { when: "Oct 11", value: 9 },
    { when: "Oct 12", value: 2 },
    { when: "Oct 13", value: 9 },
    { when: "Oct 14", value: 5 },
  ];

  it("totals the range and finds the latest and the highest", () => {
    expect(overTimeFigures(points)).toEqual({
      total: 29,
      latest: { when: "Oct 14", value: 5 },
      // Ties: the most recent, which is the one a reader is likelier to ask about.
      highest: { when: "Oct 13", value: 9 },
    });
  });

  it("has no latest or highest for an empty range", () => {
    expect(overTimeFigures([])).toEqual({ total: 0 });
  });
});

describe("the over-time text alternative", () => {
  it("states the range, the total, the latest and the highest", () => {
    expect(
      overTimeSummary({
        what: "Posts created",
        range: "last 30 days",
        points: [
          { when: "Oct 13", value: 9 },
          { when: "Oct 14", value: 5 },
        ],
        format: say,
      })
    ).toBe(
      "Posts created, last 30 days: 14 in total. Latest 5 on Oct 14; highest 9 on Oct 13."
    );
  });

  it("says plainly when nothing was created", () => {
    expect(
      overTimeSummary({
        what: "Posts created",
        range: "last 7 days",
        points: [],
        format: say,
      })
    ).toBe("Posts created, last 7 days: none.");
  });
});

describe("the groups text alternative", () => {
  const groups = [
    { label: "Published", count: 1248 },
    { label: "Draft", count: 36 },
    { label: "Scheduled", count: 6 },
  ];

  it("says how many groups, the total and which has the most, never 'largest'", () => {
    const text = groupsSummary({
      what: "Posts by status",
      groups,
      floors: false,
      format: say,
    });
    expect(text).toBe(
      "Posts by status: 3 groups, 1,290 in total. Most: Published, 1,248."
    );
    expect(text).not.toMatch(/largest/i);
  });

  it("with floors, drops 'Most' and says the counts are lower bounds", () => {
    // 🔴 A bounded scan stops counting; the group it ranked first may not be.
    const text = groupsSummary({
      what: "Issues by kind",
      groups,
      floors: true,
      format: say,
    });
    expect(text).toBe(
      "Issues by kind: 3 groups counted, at least 1,290 in all. Counts are lower bounds, and groups not counted may exist."
    );
    expect(text).not.toMatch(/most|largest/i);
  });

  it("counts one group as one, and none as none", () => {
    expect(
      groupsSummary({
        what: "Posts by status",
        groups: [{ label: "Draft", count: 2 }],
        floors: false,
        format: say,
      })
    ).toBe("Posts by status: 1 group, 2 in total. Most: Draft, 2.");
    expect(
      groupsSummary({
        what: "Posts by status",
        groups: [],
        floors: false,
        format: say,
      })
    ).toBe("Posts by status: no groups.");
  });

  it("names the first group as given, which the chart has already ordered", () => {
    // Ties were broken by label when the groups were ordered; the summary
    // names the bar drawn first, so the words and the chart agree.
    expect(
      groupsSummary({
        what: "Plans",
        groups: [
          { label: "Basic", count: 4 },
          { label: "Pro", count: 4 },
        ],
        floors: false,
        format: say,
      })
    ).toBe("Plans: 2 groups, 8 in total. Most: Basic, 4.");
  });
});

describe("the latest point's marker", () => {
  it.each(["small", "medium", "large"] as const)(
    "is circled at %s, and labelled except at small, where the figure above already says it",
    tier => {
      expect(latestMarker(tier, 8)).toEqual({
        circle: true,
        label: tier !== "small",
      });
    }
  );

  it("is circled and labelled for a single point, at every tier but small", () => {
    expect(latestMarker("medium", 1)).toEqual({ circle: true, label: true });
    expect(latestMarker("small", 1)).toEqual({ circle: true, label: false });
  });

  it("is absent with no points", () => {
    expect(latestMarker("large", 0)).toEqual({ circle: false, label: false });
  });
});
