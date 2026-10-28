/**
 * A breakdown card at each tier: the three, five or eight groups with the most entries, and a
 * word that more groups exist whenever some are left out.
 *
 * Groups are left out two ways: the server truncated the answer (it says so), or the answer was
 * fetched for a wider card than this one now is and holds more groups than this tier draws.
 * Either way the reader is told; neither way is a group silently dropped.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { sizeChartsInTests } from "../../charts/__tests__/chart-env";
import { CardTierContext } from "../../frame/tier";
import { barsBody } from "../bars";

sizeChartsInTests();
afterEach(() => cleanup());

const widget = {
  id: "acme/by-author",
  title: "Entries by author",
  archetype: "bars",
  query: { source: "collection:posts", op: "groupBy", groupBy: "author" },
} as DashboardWidget;

/** `count` groups, largest first, as the server orders them. */
function groups(count: number, truncated?: boolean): WidgetResult {
  return {
    op: "groupBy",
    buckets: Array.from({ length: count }, (_, i) => ({
      value: `Author ${i + 1}`,
      count: 100 - i,
    })),
    ...(truncated && { truncated }),
  };
}

/** Draws the card's chart at `tier`, and waits for the drawing, which loads lazily. */
async function drawAt(tier: SizeTier, result: WidgetResult): Promise<void> {
  const outcome = barsBody(result, widget);
  if (!outcome.ok || !("node" in outcome) || !outcome.node) {
    throw new Error("the bars drew nothing");
  }
  render(
    <CardTierContext.Provider value={tier}>
      {outcome.node}
    </CardTierContext.Provider>
  );
  await screen.findByTestId("chart-drawing");
}

/** The groups the chart draws, read inside the picture: the frame's table repeats them. */
const drawnGroups = () =>
  within(screen.getByRole("group", { name: /Use the arrow keys/ }))
    .getAllByText(/^Author \d+$/)
    .map(node => node.textContent);

describe("a breakdown card's groups at each tier", () => {
  it.each<[SizeTier, number]>([
    ["small", 3],
    ["medium", 5],
    ["large", 8],
  ])("draws the %s tier's %i largest groups", async (tier, drawn) => {
    await drawAt(tier, groups(10, true));
    // 🔴 The largest ones, in order: a slice from the wrong end, or every group, fails here.
    expect(drawnGroups()).toEqual(
      Array.from({ length: drawn }, (_, i) => `Author ${i + 1}`)
    );
  });

  it("says how many more groups there are when the tier draws fewer than the answer holds", async () => {
    // Fetched for a large card (a whole answer of 6 groups), drawn small: three are left out,
    // and the answer says how many.
    await drawAt("small", groups(6));
    expect(screen.getByText("3 more groups")).toBeInTheDocument();
  });

  it("says more groups exist when the server left some out", async () => {
    await drawAt("large", groups(8, true));
    expect(
      screen.getByText("More groups exist than are shown.")
    ).toBeInTheDocument();
  });

  it("says nothing more when every group is drawn", async () => {
    await drawAt("large", groups(6));
    expect(screen.queryByText(/more group/i)).not.toBeInTheDocument();
  });

  it("counts every group the answer holds in its words, and the ones left out under the bars", async () => {
    await drawAt("small", groups(6));
    expect(
      within(
        screen.getByRole("group", { name: /Use the arrow keys/ })
      ).getByText(/^Entries by author: 6 groups,/)
    ).toBeInTheDocument();
    expect(screen.getByText("3 more groups")).toBeInTheDocument();
  });
});

describe("which groups a tier cuts", () => {
  it("cuts after ordering, so a tie at the edge keeps the first label", async () => {
    // Authors 3 and 4 tie for the last place a small card draws, and the server lists 4 first.
    // Ordered by count and then label BEFORE the cut, the card draws Author 3, and its table
    // and its "1 more group" agree on which group was left out.
    await drawAt("small", {
      op: "groupBy",
      buckets: [
        { value: "Author 1", count: 100 },
        { value: "Author 2", count: 90 },
        { value: "Author 4", count: 50 },
        { value: "Author 3", count: 50 },
      ],
    });
    expect(drawnGroups()).toEqual(["Author 1", "Author 2", "Author 3"]);
    expect(screen.getByText("1 more group")).toBeInTheDocument();
  });
});
