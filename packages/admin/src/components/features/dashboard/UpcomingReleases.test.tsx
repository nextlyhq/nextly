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
import { LIST_ROW_HEIGHT_PX } from "nextly/card-geometry";
import type { CoreListWidgetData } from "nextly/core-widget-data";
import { describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import {
  CardFitContext,
  oneItemBodyPx,
} from "@admin/components/features/widgets/frame/fit";
import { render, screen, within } from "@admin/__tests__/utils";
import {
  CardHeightContext,
  CardTierContext,
} from "@admin/components/features/widgets/frame/tier";
import { WidgetCard } from "@admin/components/features/widgets/WidgetCard";

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

  it("asks its cell for the height its line and rows take while they leave a row empty, and not once they fill it", () => {
    // 🔴 Fails where the card reports nothing: its row of the dashboard then keeps their stored
    // height however short both cards' lists are. Drawn four rows high, its body holds four rows,
    // three under the attention line.
    const asked = (items: CoreListWidgetData["items"]) => {
      const report = vi.fn();
      const { unmount } = render(
        <CardFitContext.Provider value={report}>
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
        </CardFitContext.Provider>
      );
      const last = report.mock.calls.at(-1)?.[0];
      unmount();
      // Withdrawn as the body leaves, so the cell asks for the card's stored height again.
      expect(report.mock.calls.at(-1)?.[0]).toBeUndefined();
      return last;
    };
    const releases = (count: number) =>
      Array.from({ length: count }, (_, index) => release(index + 1));
    // A height to fit to (jsdom measures it as 0), not "its own rows".
    expect(asked(releases(2))).toEqual(expect.any(Number));
    expect(asked([...ATTENTION, ...releases(2)])).toEqual(expect.any(Number));
    // Four rows fill the body, and three fill it under the line: the stored height.
    expect(asked(releases(4))).toBeUndefined();
    expect(asked([...ATTENTION, ...releases(3)])).toBeUndefined();
    // More than it draws: the rows it draws fill the body, so the stored height too.
    expect(asked(releases(6))).toBeUndefined();
  });

  it("asks, while loading, for exactly the height a one-release answer then asks for", () => {
    // 🔴 Fails where the loading card asks for nothing: its cell then stands at its stored
    // height until the answer arrives and shrinks the row it shares, moving every card below.
    const report = vi.fn();
    const loading = render(
      <CardFitContext.Provider value={report}>
        <WidgetCard
          title="Upcoming releases"
          widgetId="core/upcoming-releases"
          h={4}
          state={{ kind: "loading" }}
          skeleton="rows"
        >
          {null}
        </WidgetCard>
      </CardFitContext.Provider>
    );
    const asked = report.mock.calls.at(-1)?.[0];
    loading.unmount();
    expect(asked).toBe(oneItemBodyPx("default"));

    // The answer with one scheduled release, laid out as it is drawn: one row, and no attention
    // line, which only stopped or overdue releases bring.
    const measure = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const rows = this.querySelector(':scope > [data-testid="list-card"]')
          ? this.querySelectorAll('[data-testid="entity-row"]').length
          : 0;
        const height = rows * LIST_ROW_HEIGHT_PX.default;
        return {
          top: 0,
          bottom: height,
          left: 0,
          right: 0,
          width: 0,
          height,
        } as DOMRect;
      });
    const answered = vi.fn();
    render(
      <CardFitContext.Provider value={answered}>
        <CardHeightContext.Provider value={4}>
          <CardTierContext.Provider value="medium">
            {inFrame(
              <UpcomingReleasesCard
                widgetId="core/upcoming-releases"
                placementId="card-1"
                settings={{}}
                size={{ w: 4, h: 4, tier: "medium" }}
                data={answer([release(1)])}
                refreshing={false}
                retry={() => undefined}
              />
            )}
          </CardTierContext.Provider>
        </CardHeightContext.Provider>
      </CardFitContext.Provider>
    );
    expect(screen.queryByTestId("release-attention")).toBeNull();
    expect(answered.mock.calls.at(-1)?.[0]).toBe(asked);
    measure.mockRestore();
  });
});
