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

import { CardTierContext } from "../../frame/tier";
import { barsBody } from "../bars";

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

function drawAt(tier: SizeTier, result: WidgetResult) {
  const outcome = barsBody(result, widget);
  if (!outcome.ok || !("node" in outcome) || !outcome.node) {
    throw new Error("the bars drew nothing");
  }
  render(
    <CardTierContext.Provider value={tier}>
      {outcome.node}
    </CardTierContext.Provider>
  );
}

/** The groups the chart draws, read inside the picture: the frame's table repeats them. */
const drawnGroups = () =>
  within(screen.getByRole("img"))
    .getAllByText(/^Author \d+$/)
    .map(node => node.textContent);

describe("a breakdown card's groups at each tier", () => {
  it.each<[SizeTier, number]>([
    ["small", 3],
    ["medium", 5],
    ["large", 8],
  ])("draws the %s tier's %i largest groups", (tier, drawn) => {
    drawAt(tier, groups(10, true));
    // 🔴 The largest ones, in order: a slice from the wrong end, or every group, fails here.
    expect(drawnGroups()).toEqual(
      Array.from({ length: drawn }, (_, i) => `Author ${i + 1}`)
    );
  });

  it("says how many more groups there are when the tier draws fewer than the answer holds", () => {
    // Fetched for a large card (a whole answer of 6 groups), drawn small: three are left out,
    // and the answer says how many.
    drawAt("small", groups(6));
    expect(screen.getByText("3 more groups")).toBeInTheDocument();
  });

  it("says more groups exist when the server left some out", () => {
    drawAt("large", groups(8, true));
    expect(screen.getByText(/more groups exist/i)).toBeInTheDocument();
  });

  it("says nothing more when every group is drawn", () => {
    drawAt("large", groups(6));
    expect(screen.queryByText(/more group/i)).not.toBeInTheDocument();
  });

  it("describes the groups it draws, not the ones it left out", () => {
    drawAt("small", groups(6));
    expect(
      within(screen.getByRole("img")).getByText(/^3 categories\./)
    ).toBeInTheDocument();
  });
});
