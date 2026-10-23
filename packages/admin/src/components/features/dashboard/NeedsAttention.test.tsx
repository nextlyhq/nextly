/**
 * The Needs attention card in each state and at each tier: "All clear" only
 * when nothing is waiting, "not available" for a reader who may read none of
 * it, and the kinds drawn as the card's width allows.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { NeedsAttention } from "./NeedsAttention";

const WAITING: WidgetSlot = {
  ok: true,
  result: {
    op: "groupBy",
    buckets: [
      { value: "unpublished", count: 3 },
      { value: "unpublished:collection:posts", count: 2 },
      { value: "unpublished:collection:pages", count: 1 },
      { value: "overdue", count: 1 },
    ],
    field: {
      name: "item",
      type: "string",
      choices: [
        { value: "unpublished:collection:posts", label: "Posts" },
        { value: "unpublished:collection:pages", label: "Pages" },
      ],
    },
  },
};

function drawAt(tier: SizeTier, slot: WidgetSlot | undefined) {
  render(
    <CardTierContext.Provider value={tier}>
      <NeedsAttention
        widgetId="core/needs-attention"
        placementId="core/needs-attention"
        settings={{}}
        slot={slot}
        isFetching={false}
      />
    </CardTierContext.Provider>
  );
}

describe("the Needs attention card", () => {
  it("says all clear when nothing is waiting", () => {
    drawAt("medium", { ok: true, result: { op: "groupBy", buckets: [] } });
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });

  it("says it is not available, never all clear, to a reader who may read none of it", () => {
    drawAt("medium", { ok: false, error: "x", code: "unavailable" });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
  });

  it("is the total, then a short link per kind, when small", () => {
    drawAt("small", WAITING);
    expect(screen.getByTestId("needs-attention-total")).toHaveTextContent("4");
    expect(screen.getByText("Unpublished changes")).toBeInTheDocument();
    expect(screen.getByText("Overdue releases")).toBeInTheDocument();
    expect(screen.queryByText("Posts")).not.toBeInTheDocument();
  });

  it("is a row per kind when medium, offering the parts of a kind no one list holds", () => {
    drawAt("medium", WAITING);
    expect(
      screen.queryByTestId("needs-attention-total")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Overdue releases: 1" })
    ).toHaveAttribute("href", "/admin/releases?tab=attention&reason=overdue");
    // Spread over two collections, the kind leads nowhere itself, so its
    // parts are the links.
    expect(screen.getByRole("link", { name: "Posts: 2" })).toBeInTheDocument();
  });

  it("breaks each kind down per collection when large", () => {
    drawAt("large", WAITING);
    expect(screen.getByRole("link", { name: "Posts: 2" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pages: 1" })).toBeInTheDocument();
  });

  it("says a floor aloud as a floor", () => {
    drawAt("medium", {
      ok: true,
      result: {
        op: "groupBy",
        buckets: [{ value: "overdue", count: 99, atLeast: true }],
        atLeast: true,
      },
    });
    expect(
      screen.getByRole("link", { name: "Overdue releases: 99 or more" })
    ).toBeInTheDocument();
  });
});
