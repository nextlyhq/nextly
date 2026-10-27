/**
 * The Count card at each width: the number alone when small, the published and
 * draft split when medium, the trend and its change when large, and "not
 * available" when its read was refused.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { CountCard } from "./CountCard";

const CELLS: Record<string, WidgetSlot> = {
  split: {
    ok: true,
    result: {
      op: "groupBy",
      buckets: [
        { value: "published", count: 7 },
        { value: "draft", count: 3 },
      ],
    },
  },
  trend: {
    ok: true,
    result: {
      op: "timeseries",
      interval: "day",
      points: [
        { start: "2026-10-21T00:00:00.000Z", count: 2 },
        { start: "2026-10-22T00:00:00.000Z", count: 5 },
      ],
    },
  },
  prior: { ok: true, result: { op: "count", total: 4 } },
};

function drawAt(tier: SizeTier, cells: Record<string, WidgetSlot>) {
  render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <CountCard
          widgetId="core/count"
          placementId="core/count:posts"
          settings={{ collection: "posts" }}
          slot={undefined}
          cells={cells}
          isFetching={false}
        />
      )}
    </CardTierContext.Provider>
  );
}

describe("the Count card", () => {
  it("is the number alone when small", () => {
    drawAt("small", CELLS);
    expect(screen.getByLabelText("Entries in posts: 10")).toBeInTheDocument();
    expect(screen.queryByTestId("count-split")).not.toBeInTheDocument();
    expect(screen.queryByTestId("count-trend")).not.toBeInTheDocument();
  });

  it("adds the split when medium, each part linking to its list", () => {
    drawAt("medium", CELLS);
    expect(screen.getByLabelText("Published: 7")).toHaveAttribute(
      "href",
      "/admin/collections/posts?status=published"
    );
    expect(screen.getByLabelText("Draft: 3")).toBeInTheDocument();
    expect(screen.queryByTestId("count-trend")).not.toBeInTheDocument();
  });

  it("adds what scheduled releases will publish when medium", () => {
    drawAt("medium", {
      ...CELLS,
      scheduled: { ok: true, result: { op: "count", total: 2 } },
    });
    expect(
      screen.getByRole("link", { name: "Scheduled: 2" })
    ).toBeInTheDocument();
  });

  it("leaves the scheduled row out when its read is not available", () => {
    drawAt("medium", {
      ...CELLS,
      scheduled: { ok: false, error: "x", code: "unavailable" },
    });
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Draft: 3" })).toBeInTheDocument();
  });

  it("adds the trend and its change when large", () => {
    drawAt("large", CELLS);
    expect(screen.getByTestId("count-trend")).toHaveTextContent(
      "7 created in the last 30 days, 3 more than the 30 before."
    );
  });

  it("draws the number before the trend has answered", () => {
    drawAt("large", { split: CELLS.split });
    expect(screen.getByLabelText("Entries in posts: 10")).toBeInTheDocument();
    expect(screen.queryByTestId("count-trend")).not.toBeInTheDocument();
  });

  it("offers Retry when its read failed, asking the card again", () => {
    const onRetry = vi.fn();
    render(
      <CardTierContext.Provider value="medium">
        {inFrame(
          <CountCard
            widgetId="core/count"
            placementId="core/count:posts"
            settings={{ collection: "posts" }}
            slot={undefined}
            cells={{ split: { ok: false, error: "Down" } }}
            isFetching={false}
            onRetry={onRetry}
          />
        )}
      </CardTierContext.Provider>
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says it is not available when its read was refused", () => {
    drawAt("medium", { split: { ok: false, error: "x", code: "unavailable" } });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });
});
