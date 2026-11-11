/**
 * The dashboard's Upcoming releases card, drawn from the rows its `load` read
 * from `system:releases`: the line naming releases that need attention above the rows at every
 * size, each part linking to the Releases list filtered to its reason; the rows
 * as core's lists draw them, each a date chip, the release's name, its entries
 * and its status, leading to its release. The frame draws loading, error and
 * the empty card before the component is reached, so those are the frame's
 * own tests.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { CoreListWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";
import {
  CardHeightContext,
  CardTierContext,
} from "@admin/components/features/widgets/frame/tier";

import { UpcomingReleasesCard } from "./UpcomingReleases";

const release = (
  n: number,
  extra: CoreListWidgetData["items"][number] = {}
) => ({
  kind: "release",
  id: `r${n}`,
  title: `Launch ${n}`,
  scheduledAt: "2099-01-01T12:00:00.000Z",
  entries: 3,
  issues: 0,
  ...extra,
});

/** The data the card's `load` answers: the source's rows. */
const answer = (items: CoreListWidgetData["items"]): CoreListWidgetData => ({
  items,
});

function draw(data: CoreListWidgetData, tier: SizeTier = "medium") {
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <UpcomingReleasesCard
          widgetId="core/upcoming-releases"
          placementId="card-1"
          settings={{}}
          size={{ w: 4, h: 4, tier }}
          data={data}
          refreshing={false}
          retry={() => undefined}
        />
      )}
    </CardTierContext.Provider>
  );
}

const ATTENTION = [
  { kind: "attention", reason: "stopped", count: 1 },
  { kind: "attention", reason: "overdue", count: 2 },
];

describe("the releases that need attention", () => {
  it.each<SizeTier>(["small", "medium", "large"])(
    "are named above the rows at %s, each linking to its reason",
    tier => {
      draw(answer([...ATTENTION, release(1)]), tier);
      const line = screen.getByTestId("release-attention");
      expect(line).toHaveTextContent("1 stopped");
      expect(line).toHaveTextContent("2 overdue");
      expect(screen.getByRole("link", { name: /1 stopped/ })).toHaveAttribute(
        "href",
        expect.stringContaining("tab=attention&reason=stopped")
      );
      expect(screen.getByRole("link", { name: /2 overdue/ })).toHaveAttribute(
        "href",
        expect.stringContaining("tab=attention&reason=overdue")
      );
      expect(screen.getByText("Launch 1")).toBeInTheDocument();
    }
  );

  it.each<SizeTier>(["small", "medium", "large"])(
    "leave no line at %s when none need attention",
    tier => {
      draw(answer([release(1)]), tier);
      expect(screen.queryByTestId("release-attention")).toBeNull();
      expect(screen.getByText("Launch 1")).toBeInTheDocument();
    }
  );
});

describe("the upcoming rows", () => {
  it("say there are more from the release rows alone, never the attention rows", () => {
    // Five releases and two attention counts at medium: the attention line takes a row's room,
    // so four releases are drawn, and the footer counts releases alone, at least five, never
    // the seven rows the answer holds.
    draw(
      answer([...ATTENTION, ...[1, 2, 3, 4, 5].map(n => release(n))]),
      "medium"
    );
    expect(screen.getAllByTestId("entity-row")).toHaveLength(4);
    expect(screen.getByTestId("list-card-footer")).toHaveTextContent(
      "View all (5+)"
    );
  });

  it("say there are more when the release rows hold one more than the card draws", () => {
    // The footer leads to Releases. The source counts no total, so the extra row says at least
    // six exist.
    draw(answer([...[1, 2, 3, 4, 5, 6].map(n => release(n))]), "medium");
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    const footer = screen.getByTestId("list-card-footer");
    expect(footer).toHaveTextContent("View all (6+)");
    expect(footer).toHaveAttribute("href", "/admin/releases");
  });

  it("leave the attention line its room, so no row is drawn past the card's edge", () => {
    // 🔴 Four rows tall, the body holds four rows, and none to spare: counted without the line
    // above them, the fourth row would be cut off at the card's foot.
    const releases = [1, 2, 3, 4, 5, 6].map(n => release(n));
    const drawAt = (items: CoreListWidgetData["items"]) =>
      render(
        <CardHeightContext.Provider value={4}>
          <CardTierContext.Provider value="medium">
            {inFrame(
              <UpcomingReleasesCard
                widgetId="core/upcoming-releases"
                placementId="card-1"
                settings={{}}
                size={{ w: 4, h: 4, tier: "medium" }}
                data={answer(items)}
                refreshing={false}
                retry={() => undefined}
              />
            )}
          </CardTierContext.Provider>
        </CardHeightContext.Provider>
      );
    const { unmount } = drawAt(releases);
    expect(screen.getAllByTestId("entity-row")).toHaveLength(4);
    unmount();
    drawAt([...ATTENTION, ...releases]);
    expect(screen.getByTestId("release-attention")).toBeInTheDocument();
    expect(screen.getAllByTestId("entity-row")).toHaveLength(3);
  });

  it("draw each release as a date chip, its name, its entries and its status", () => {
    draw(
      answer([
        release(1, { scheduledAt: "2099-03-14T12:00:00.000Z", entries: 1 }),
        release(2, { entries: 4, issues: 2 }),
        release(3, { issues: 1 }),
        // Left unchecked by the source: no status rather than a guess.
        release(4, { issues: null }),
      ]),
      "medium"
    );
    const rows = screen.getAllByTestId("entity-row");
    expect(
      within(rows[0]!).getByTestId("entity-row-leading")
    ).toHaveTextContent("14");
    expect(within(rows[0]!).getByTestId("entity-row-title")).toHaveTextContent(
      "Launch 1"
    );
    expect(within(rows[0]!).getByTestId("entity-row-meta")).toHaveTextContent(
      "1 entry"
    );
    expect(within(rows[0]!).getByTestId("status-pill")).toHaveTextContent(
      "Ready"
    );
    expect(within(rows[1]!).getByTestId("entity-row-meta")).toHaveTextContent(
      "4 entries"
    );
    expect(within(rows[1]!).getByTestId("status-pill")).toHaveTextContent(
      "2 issues"
    );
    expect(within(rows[1]!).getByTestId("status-pill")).toHaveAttribute(
      "data-tone",
      "bad"
    );
    expect(within(rows[2]!).getByTestId("status-pill")).toHaveTextContent(
      "1 issue"
    );
    expect(within(rows[3]!).queryByTestId("status-pill")).toBeNull();
  });

  it("lead each release row to its release", () => {
    draw(answer([release(1), release(2)]), "medium");
    expect(screen.getByText("Launch 2").closest("a")).toHaveAttribute(
      "href",
      "/admin/releases/r2"
    );
  });

  it("draws the standard empty state for rows this build cannot read", () => {
    // The frame draws an empty answer itself; a row of a kind the card does
    // not know is left out, so an answer of only those draws the same state.
    draw(answer([{ kind: "unknown" }]));
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
  });
});
