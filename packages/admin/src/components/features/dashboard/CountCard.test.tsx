/**
 * The Count card drawn from the data its `load` answers: what it counts, the
 * number written whole at a quarter and at half of the dashboard, from 0 to
 * tens of thousands, then the one line under it (the change this week, the
 * trend, the split by status, or nothing), for a collection and for Users;
 * and "not available" for a card set to no collection.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { CountWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { CountCard } from "./CountCard";

/** A quarter of the dashboard (3 of 12 columns) and half of it (6), with the tier each is drawn at. */
const WIDTHS: readonly { name: string; w: number; tier: SizeTier }[] = [
  { name: "25%", w: 3, tier: "small" },
  { name: "50%", w: 6, tier: "medium" },
];

function drawAt(
  { w, tier }: { w: number; tier: SizeTier },
  data: CountWidgetData,
  settings: Record<string, unknown> = { collection: "posts" }
) {
  render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <CountCard
          widgetId="core/count"
          placementId="core/count:posts"
          settings={settings}
          size={{ w, h: 2, tier }}
          data={data}
          refreshing={false}
          retry={() => undefined}
        />
      )}
    </CardTierContext.Provider>
  );
}

const QUARTER = WIDTHS[0]!;

describe.each(WIDTHS)("the Count card at $name", width => {
  it.each([
    [0, "0", 0, "No change this week"],
    [3, "3", 1, "+1 this week"],
    [24, "24", 3, "+3 this week"],
    [12480, "12,480", 1204, "+1,204 this week"],
  ])(
    "draws %i as its label, the number written whole, then the change this week",
    (total, written, change, line) => {
      drawAt(width, { total, counted: "all", line: "change", change });
      const card = screen.getByTestId("count-card");
      expect(within(card).getByTestId("count-label")).toHaveTextContent(
        "Entries"
      );
      // 🔴 Never "12.5k" in a quarter-width card: the number is the card.
      const number = within(card).getByRole("link", {
        name: `Entries in posts: ${written}`,
      });
      expect(number.textContent).toBe(written);
      expect(number).toHaveClass("text-[30px]", "whitespace-nowrap");
      expect(number).toHaveAttribute("href", "/admin/collections/posts");
      expect(within(card).getByTestId("count-change")).toHaveTextContent(line);
      // One line: nothing else under the number.
      expect(screen.queryByTestId("count-trend")).toBeNull();
      expect(screen.queryByTestId("count-split")).toBeNull();
    }
  );

  it("draws the trend line beside the number, over the last 8 weeks", () => {
    drawAt(width, {
      total: 12480,
      counted: "all",
      line: "trend",
      trend: [11000, 11200, 11500, 11500, 11800, 12000, 12100, 12300, 12480],
    });
    expect(screen.getByTestId("count-trend-line")).toBeInTheDocument();
    expect(screen.getByTestId("count-trend")).toHaveTextContent(
      "Last 8 weeks: from 11,000 to 12,480"
    );
    expect(screen.getByText("12,480")).toBeInTheDocument();
  });
});

describe("the Count card", () => {
  it("names the drafts it counts, and links them to that list", () => {
    drawAt(QUARTER, { total: 3, counted: "draft", line: "change", change: 0 });
    expect(screen.getByTestId("count-label")).toHaveTextContent("Drafts");
    expect(
      screen.getByRole("link", { name: "Drafts in posts: 3" })
    ).toHaveAttribute("href", "/admin/collections/posts?status=draft");
    expect(screen.getByTestId("count-change")).toHaveTextContent(
      "No change this week"
    );
  });

  it("counts people for Users, linking to the users list", () => {
    drawAt(
      QUARTER,
      { total: 24, counted: "people", line: "change", change: 2 },
      { collection: "users" }
    );
    expect(screen.getByTestId("count-label")).toHaveTextContent("People");
    expect(screen.getByRole("link", { name: "People: 24" })).toHaveAttribute(
      "href",
      "/admin/users"
    );
    expect(screen.getByTestId("count-change")).toHaveTextContent(
      "+2 this week"
    );
  });

  it("splits by status: a bar, and a legend whose every part links to its list", () => {
    drawAt(QUARTER, {
      total: 128,
      counted: "all",
      line: "split",
      split: { published: 104, draft: 24, scheduled: 3 },
    });
    const split = screen.getByTestId("count-split");
    expect(
      within(split)
        .getAllByRole("link")
        .map(link => [link.textContent, link.getAttribute("href")])
    ).toEqual([
      ["104 published", "/admin/collections/posts?status=published"],
      ["24 draft", "/admin/collections/posts?status=draft"],
      [
        "3 scheduled",
        expect.stringMatching(/^\/admin\/collections\/posts\?where=/),
      ],
    ]);
  });

  it("leaves scheduled out of the split where none is scheduled or it was not read", () => {
    drawAt(QUARTER, {
      total: 10,
      counted: "all",
      line: "split",
      split: { published: 7, draft: 3 },
    });
    expect(screen.queryByText(/scheduled/)).toBeNull();
    expect(
      within(screen.getByTestId("count-split")).getAllByRole("link")
    ).toHaveLength(2);
  });

  it("draws the number alone when it shows nothing under it", () => {
    drawAt(QUARTER, { total: 7, counted: "all", line: "none" });
    expect(screen.getByRole("link", { name: "Entries in posts: 7" })).toBeInTheDocument();
    expect(screen.queryByTestId("count-change")).toBeNull();
    expect(screen.queryByTestId("count-trend")).toBeNull();
    expect(screen.queryByTestId("count-split")).toBeNull();
  });

  it("says it is not available when it is set to no collection", () => {
    drawAt(QUARTER, { total: 7, counted: "all", line: "none" }, {});
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });
});
