/**
 * The dashboard's Upcoming releases card, drawn from its `system:releases`
 * answer: the line naming releases that need attention above the rows at every
 * size, each part linking to the Releases list filtered to its reason; the rows
 * as core's lists draw them, each a date chip, the release's name, its entries
 * and its status, leading to its release; and the frame's own states.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";
import {
  CardHeightContext,
  CardTierContext,
} from "@admin/components/features/widgets/frame/tier";

import { UpcomingReleasesCard } from "./UpcomingReleases";

const QUERY = {
  source: "system:releases",
  op: "list" as const,
  select: [
    "kind",
    "id",
    "title",
    "scheduledAt",
    "entries",
    "issues",
    "reason",
    "count",
  ],
  limit: 5,
};

const FIELDS = [
  { name: "title", label: "Release", type: "string" as const },
  { name: "scheduledAt", label: "Scheduled", type: "date" as const },
];

const release = (n: number, extra: Record<string, unknown> = {}) => ({
  kind: "release",
  id: `r${n}`,
  title: `Launch ${n}`,
  scheduledAt: "2099-01-01T12:00:00.000Z",
  entries: 3,
  issues: 0,
  ...extra,
});

function answer(items: Record<string, unknown>[]) {
  return {
    ok: true as const,
    result: { op: "list" as const, items, fields: FIELDS },
  };
}

function draw(props: Partial<WidgetComponentProps>, tier: SizeTier = "medium") {
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <UpcomingReleasesCard
          widgetId="core/upcoming-releases"
          placementId="card-1"
          settings={{}}
          slot={undefined}
          isFetching={false}
          query={QUERY}
          {...props}
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
      draw({ slot: answer([...ATTENTION, release(1)]) }, tier);
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
      draw({ slot: answer([release(1)]) }, tier);
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
      {
        slot: answer([...ATTENTION, ...[1, 2, 3, 4, 5].map(n => release(n))]),
      },
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
    draw(
      { slot: answer([...[1, 2, 3, 4, 5, 6].map(n => release(n))]) },
      "medium"
    );
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    const footer = screen.getByTestId("list-card-footer");
    expect(footer).toHaveTextContent("View all (6+)");
    expect(footer).toHaveAttribute("href", "/admin/releases");
  });

  it("leave the attention line its room, so no row is drawn past the card's edge", () => {
    // 🔴 Four rows tall, the body holds four rows, and none to spare: counted without the line
    // above them, the fourth row would be cut off at the card's foot.
    const releases = [1, 2, 3, 4, 5, 6].map(n => release(n));
    const drawAt = (items: Record<string, unknown>[]) =>
      render(
        <CardHeightContext.Provider value={4}>
          <CardTierContext.Provider value="medium">
            {inFrame(
              <UpcomingReleasesCard
                widgetId="core/upcoming-releases"
                placementId="card-1"
                settings={{}}
                slot={answer(items)}
                isFetching={false}
                query={QUERY}
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
      {
        slot: answer([
          release(1, { scheduledAt: "2099-03-14T12:00:00.000Z", entries: 1 }),
          release(2, { entries: 4, issues: 2 }),
          release(3, { issues: 1 }),
          // Left unchecked by the source: no status rather than a guess.
          release(4, { issues: null }),
        ]),
      },
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
    draw({ slot: answer([release(1), release(2)]) }, "medium");
    expect(screen.getByText("Launch 2").closest("a")).toHaveAttribute(
      "href",
      "/admin/releases/r2"
    );
  });

  it("draws the standard empty state when nothing is scheduled or waiting", () => {
    draw({ slot: answer([]) });
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
  });
});

describe("the card's states", () => {
  it("says it is not available when the source refused this reader", () => {
    draw({ slot: { ok: false, error: "Not available", code: "unavailable" } });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });

  it("offers Retry on its error, asking the card's question again", () => {
    const onRetry = vi.fn();
    draw({
      slot: { ok: false, error: "The database did not answer." },
      onRetry,
    });
    screen.getByRole("button", { name: /retry/i }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
