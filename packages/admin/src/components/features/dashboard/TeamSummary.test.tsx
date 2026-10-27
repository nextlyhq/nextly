/**
 * The team card at each tier, drawn from its `system:team` answer: the number of
 * people alone when small, people and roles beside each other from medium up.
 * Only the figures the source sent are drawn, so a reader who may not see roles
 * gets no roles tile at all, never a zero.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetComponentProps } from "nextly/widget-result";
import { describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { TeamSummary } from "./TeamSummary";

/** The source's answer: one row per figure it sent. */
function answered(figures: { users?: number; roles?: number }) {
  return {
    ok: true as const,
    result: {
      op: "list" as const,
      items: Object.entries(figures).map(([figure, count]) => ({
        figure,
        count,
      })),
    },
  };
}

function draw(props: Partial<WidgetComponentProps>, tier: SizeTier = "medium") {
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <TeamSummary
          widgetId="core/team"
          placementId="core/team"
          settings={{}}
          slot={undefined}
          isFetching={false}
          {...props}
        />
      )}
    </CardTierContext.Provider>
  );
}

describe("the team card at each tier", () => {
  it("is the number of people alone when small", () => {
    draw({ slot: answered({ users: 12, roles: 3 }) }, "small");
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
  });

  it.each<SizeTier>(["medium", "large"])(
    "shows people and roles at %s",
    tier => {
      draw({ slot: answered({ users: 12, roles: 3 }) }, tier);
      expect(screen.getByText("Users")).toBeInTheDocument();
      expect(screen.getByText("Roles")).toBeInTheDocument();
    }
  );

  it("draws no roles tile when the source sent no roles figure, never a zero", () => {
    draw({ slot: answered({ users: 12 }) }, "large");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("the team card's states", () => {
  it("holds its place while the first answer is on the way, and is not available with no request", () => {
    const { unmount } = draw({ isFetching: true });
    expect(screen.getByTestId("card-skeleton")).toHaveAttribute(
      "data-shape",
      "figure"
    );
    unmount();
    draw({});
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });

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
