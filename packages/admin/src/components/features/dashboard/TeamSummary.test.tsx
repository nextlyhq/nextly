/**
 * The team card at each tier: the number of people alone when small, people and roles beside
 * each other from medium up. Only the counts the reader may see are drawn, so a small card for a
 * reader who may see only the roles draws the roles.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { useDashboardStats } from "@admin/hooks/queries";

import { CardTierContext } from "../widgets/frame/tier";

import { TeamSummary } from "./TeamSummary";

vi.mock("@admin/hooks/queries", () => ({ useDashboardStats: vi.fn() }));

function drawAt(
  tier: SizeTier,
  counts: { users?: number; roles?: number } = { users: 12, roles: 3 }
) {
  vi.mocked(useDashboardStats).mockReturnValue({
    data: counts,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDashboardStats>);
  render(
    <CardTierContext.Provider value={tier}>
      <TeamSummary />
    </CardTierContext.Provider>
  );
}

describe("the team card at each tier", () => {
  it("is the number of people alone when small", () => {
    drawAt("small");
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
  });

  it("is the roles alone when small and the people are not the reader's to see", () => {
    drawAt("small", { roles: 3 });
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // Not the people drawn as nobody: a withheld count is left out, never a zero.
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it.each<SizeTier>(["medium", "large"])(
    "shows people and roles at %s",
    tier => {
      drawAt(tier);
      expect(screen.getByText("Users")).toBeInTheDocument();
      expect(screen.getByText("Roles")).toBeInTheDocument();
    }
  );
});
