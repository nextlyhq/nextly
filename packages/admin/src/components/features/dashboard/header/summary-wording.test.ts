import { describe, expect, it } from "vitest";

import type { DashboardSummary } from "@admin/types/dashboard/summary";

import { summaryLine } from "./summary-wording";

// Midday on the reader's own clock, so "today" and "tomorrow" do not depend on
// the zone the tests run in.
const now = new Date(2026, 9, 28, 12, 0, 0);
const at = (days: number, hour = 12) =>
  new Date(2026, 9, 28 + days, hour, 0, 0).toISOString();

function texts(summary: DashboardSummary): string[] | string {
  const line = summaryLine(summary, now);
  return line.kind === "parts" ? line.parts.map(part => part.text) : line.kind;
}

describe("the summary line", () => {
  it("words each part, one and many", () => {
    expect(
      texts({ parts: [{ kind: "attention", count: 1 }], failed: 0 })
    ).toEqual(["1 thing needs you"]);
    expect(
      texts({ parts: [{ kind: "attention", count: 2 }], failed: 0 })
    ).toEqual(["2 things need you"]);
    expect(
      texts({
        parts: [{ kind: "releases", count: 1, nearest: at(1) }],
        failed: 0,
      })
    ).toEqual(["1 release tomorrow"]);
    expect(
      texts({
        parts: [
          {
            kind: "widget",
            widget: "acme/forms",
            card: "c1",
            label: "new submissions",
            count: 3,
          },
        ],
        failed: 0,
      })
    ).toEqual(["3 new submissions"]);
  });

  it("words releases by the nearest one's day on the reader's calendar", () => {
    const releases = (nearest: string) =>
      texts({ parts: [{ kind: "releases", count: 2, nearest }], failed: 0 });
    expect(releases(at(0, 23))).toEqual(["2 releases today"]);
    expect(releases(at(1, 0))).toEqual(["2 releases tomorrow"]);
    expect(releases(at(5))).toEqual(["2 releases this week"]);
  });

  it("draws a floor as N+, worded as many", () => {
    expect(
      texts({
        parts: [{ kind: "attention", count: 1, atLeast: true }],
        failed: 0,
      })
    ).toEqual(["1+ things need you"]);
    // A widget's part too, when its count is a floor.
    expect(
      texts({
        parts: [
          {
            kind: "widget",
            widget: "acme/forms",
            card: "c1",
            label: "new submissions",
            count: 1000,
            atLeast: true,
          },
        ],
        failed: 0,
      })
    ).toEqual(["1000+ new submissions"]);
  });

  it("puts attention, then releases, then each widget's part, whatever order they came in", () => {
    expect(
      texts({
        parts: [
          {
            kind: "widget",
            widget: "acme/forms",
            card: "c1",
            label: "new submissions",
            count: 3,
          },
          { kind: "releases", count: 1, nearest: at(1) },
          { kind: "attention", count: 2 },
        ],
        failed: 0,
      })
    ).toEqual(["2 things need you", "1 release tomorrow", "3 new submissions"]);
  });

  it("says all caught up only when every part was read and none has anything", () => {
    expect(texts({ parts: [], failed: 0 })).toBe("caught-up");
    // A part that could not be read may have something: no claim either way.
    expect(texts({ parts: [], failed: 1 })).toBe("none");
    expect(
      texts({ parts: [{ kind: "attention", count: 2 }], failed: 1 })
    ).toEqual(["2 things need you"]);
  });

  it("names each part's card, and the list it opens without one", () => {
    const line = summaryLine(
      {
        parts: [
          { kind: "attention", count: 2, link: "releases?tab=attention" },
          { kind: "releases", count: 1, nearest: at(1) },
          {
            kind: "widget",
            widget: "acme/forms",
            card: "c1",
            label: "new",
            count: 3,
          },
        ],
        failed: 0,
      },
      now
    );
    expect(line).toEqual({
      kind: "parts",
      parts: [
        expect.objectContaining({
          widget: "core/needs-attention",
          href: "/admin/releases?tab=attention",
        }),
        expect.objectContaining({
          widget: "core/upcoming-releases",
          href: "/admin/releases",
        }),
        expect.not.objectContaining({ href: expect.anything() }),
      ],
    });
  });

  it("carries the very card a widget's part names, which need not be its first", () => {
    const line = summaryLine(
      {
        parts: [
          { kind: "attention", count: 2 },
          {
            kind: "widget",
            widget: "acme/forms",
            card: "c2",
            label: "new",
            count: 3,
          },
        ],
        failed: 0,
      },
      now
    );
    expect(line.kind === "parts" && line.parts[1]).toMatchObject({
      widget: "acme/forms",
      card: "c2",
    });
    // The attention part names no card of its own: its widget's first.
    expect(line.kind === "parts" && line.parts[0]).not.toHaveProperty("card");
  });

  it("draws no link for an attention item's link that leaves the admin", () => {
    const line = summaryLine(
      {
        parts: [{ kind: "attention", count: 2, link: "//evil.example" }],
        failed: 0,
      },
      now
    );
    expect(line.kind === "parts" && line.parts[0]).not.toHaveProperty("href");
  });
});
