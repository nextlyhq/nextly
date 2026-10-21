/**
 * The "Changes (24h)" figure when the server stopped counting at its bound: written as a floor,
 * the way every bounded count on the dashboard is, and as a plain number when it is whole.
 *
 * @module components/features/dashboard/recent-changes-floor.test
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { useDashboardStats } from "@admin/hooks/queries/useDashboardStats";
import type { DashboardStats } from "@admin/types/dashboard/stats";

import { cardNumber } from "../widgets/frame/format";

const statsHook = vi.fn<typeof useDashboardStats>();

vi.mock("@admin/hooks/queries/useDashboardStats", () => ({
  useDashboardStats: () => statsHook(),
}));

const { ContentStatsGrid } = await import("./ContentStatsGrid");

function answers(content: DashboardStats["content"]) {
  statsHook.mockReturnValue({
    data: {
      content,
      status: { published: 0, draft: 0 },
      collectionCounts: [],
      singles: 0,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDashboardStats>);
}

const CONTENT = { totalEntries: 12, contentTypes: 14 };

afterEach(() => {
  vi.clearAllMocks();
});

describe("the recent-changes figure", () => {
  it("is written as a floor when the server stopped counting", () => {
    answers({
      ...CONTENT,
      recentChanges24h: 1000,
      recentChanges24hAtLeast: true,
    });
    render(<ContentStatsGrid />);
    const floor = cardNumber(1000, { floor: true }).text;
    expect(floor).not.toBe(cardNumber(1000).text);
    expect(screen.getAllByText(floor).length).toBeGreaterThan(0);
  });

  it("is written as the number when it is whole", () => {
    answers({ ...CONTENT, recentChanges24h: 1000 });
    render(<ContentStatsGrid />);
    expect(screen.getAllByText(cardNumber(1000).text).length).toBeGreaterThan(
      0
    );
    expect(
      screen.queryAllByText(cardNumber(1000, { floor: true }).text)
    ).toEqual([]);
  });
});
