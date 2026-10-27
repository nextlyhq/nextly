/**
 * The dashboard's Upcoming releases card, drawn from its `system:releases`
 * answer: the line naming releases that need attention above the rows at every
 * size, each part linking to the Releases list filtered to its reason; the rows
 * as core's lists draw them, each leading to its release; and the frame's own
 * states.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen } from "@admin/__tests__/utils";
import {
  CardHeightContext,
  CardTierContext,
} from "@admin/components/features/widgets/frame/tier";

import { UpcomingReleasesCard } from "./UpcomingReleases";

const QUERY = {
  source: "system:releases",
  op: "list" as const,
  select: ["kind", "title", "scheduledAt", "reason", "count"],
  limit: 5,
};

const FIELDS = [
  { name: "title", label: "Release", type: "string" as const },
  { name: "scheduledAt", label: "Scheduled", type: "date" as const },
];

const release = (n: number) => ({
  kind: "release",
  id: `r${n}`,
  title: `Launch ${n}`,
  scheduledAt: "2099-01-01T00:00:00.000Z",
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
        slot: answer([...ATTENTION, ...[1, 2, 3, 4, 5].map(release)]),
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
    draw({ slot: answer([...[1, 2, 3, 4, 5, 6].map(release)]) }, "medium");
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    const footer = screen.getByTestId("list-card-footer");
    expect(footer).toHaveTextContent("View all (6+)");
    expect(footer).toHaveAttribute("href", "/admin/releases");
  });

  it("leave the attention line its room, so no row is drawn past the card's edge", () => {
    // 🔴 Four rows tall, the body holds four rows, and none to spare: counted without the line
    // above them, the fourth row would be cut off at the card's foot.
    const releases = [1, 2, 3, 4, 5, 6].map(release);
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
