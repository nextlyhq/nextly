/**
 * The team card at each tier, drawn from the counts its `load` answered: the
 * number of people alone when small, people and roles beside each other from
 * medium up. Only the figures the source sent are drawn, so a reader who may
 * not see roles gets no roles tile at all, never a zero. Its "All users" link
 * is drawn in the card's footer.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { TeamWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { TeamSummary } from "./TeamSummary";

function draw(data: TeamWidgetData, tier: SizeTier = "medium") {
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <TeamSummary
          widgetId="core/team"
          placementId="core/team"
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

describe("the team card at each tier", () => {
  it("is the number of people alone when small", () => {
    draw({ users: 12, roles: 3 }, "small");
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
  });

  it.each<SizeTier>(["medium", "large"])(
    "shows people and roles at %s",
    tier => {
      draw({ users: 12, roles: 3 }, tier);
      expect(screen.getByText("Users")).toBeInTheDocument();
      expect(screen.getByText("Roles")).toBeInTheDocument();
    }
  );

  it("draws no roles tile when the source sent no roles figure, never a zero", () => {
    draw({ users: 12 }, "large");
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("the team card's link and states", () => {
  it("leads to every user from its footer", () => {
    draw({ users: 12, roles: 3 });
    expect(screen.getByRole("link", { name: "All users" })).toHaveAttribute(
      "href",
      expect.stringContaining("/users")
    );
  });

  it("says it is not available when the source sent neither figure", () => {
    draw({});
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });
});
