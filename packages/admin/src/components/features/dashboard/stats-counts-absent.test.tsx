/**
 * The readers of the dashboard summary's admin counts, with a count missing.
 *
 * The summary leaves out each installation-wide count a reader may not read:
 * users, roles, permissions, media, field groups, active API keys. A reader
 * that drew a missing count as `0` would put back the answer the server stopped
 * giving -- and a wrong one, since there are users; one that threw would take
 * the dashboard down for the people with the fewest grants. So a missing count
 * is not drawn at all.
 *
 * @module components/features/dashboard/stats-counts-absent.test
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { useDashboardStats } from "@admin/hooks/queries/useDashboardStats";
import type { DashboardStats } from "@admin/types/dashboard/stats";

import { UNAVAILABLE_TITLE } from "../widgets/frame/states";

const statsHook = vi.fn<typeof useDashboardStats>();

vi.mock("@admin/hooks/queries", () => ({
  useDashboardStats: () => statsHook(),
}));
vi.mock("@admin/hooks/queries/useDashboardStats", () => ({
  useDashboardStats: () => statsHook(),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));

const { TeamSummary } = await import("./TeamSummary");
const { ProjectStatsGrid } = await import("./ProjectStatsGrid");
const { ContentStatsGrid } = await import("./ContentStatsGrid");

/** A summary carrying every count, each a distinct non-zero number. */
const FULL: DashboardStats = {
  content: {
    totalEntries: 12,
    totalMedia: 13,
    contentTypes: 14,
    recentChanges24h: 15,
  },
  status: { published: 16, draft: 17 },
  collectionCounts: [],
  users: 21,
  roles: 22,
  permissions: 23,
  fieldGroups: 24,
  singles: 25,
  apiKeys: 26,
};

/** The summary a reader who may read none of the admin counts is given. */
function withoutAdminCounts(): DashboardStats {
  const {
    users: _users,
    roles: _roles,
    permissions: _permissions,
    fieldGroups: _fieldGroups,
    apiKeys: _apiKeys,
    ...rest
  } = FULL;
  const { totalMedia: _media, ...content } = FULL.content;
  return { ...rest, content };
}

function answers(data: DashboardStats) {
  statsHook.mockReturnValue({
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDashboardStats>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the Team card", () => {
  it("draws both counts when both are given", () => {
    // The control for every absence below.
    answers(FULL);
    render(<TeamSummary />);
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
  });

  it("leaves out a count it is not given, rather than drawing 0", () => {
    const { users: _users, ...rest } = FULL;
    answers(rest);
    render(<TeamSummary />);
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("Roles")).toBeInTheDocument();
  });

  it("says it is not available when it is given neither", () => {
    answers(withoutAdminCounts());
    render(<TeamSummary />);
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.queryByText("Roles")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    // The frame's one unavailable state, worded the same whatever the reason.
    expect(screen.getByText(UNAVAILABLE_TITLE)).toBeInTheDocument();
  });
});

describe("the project statistics grid", () => {
  it("draws every figure when every count is given", () => {
    answers(FULL);
    render(<ProjectStatsGrid />);
    for (const title of ["Media", "Field Groups", "Users", "Security"]) {
      expect(screen.getByText(title), title).toBeInTheDocument();
    }
  });

  it("leaves out each figure it is not given, rather than drawing 0", () => {
    answers(withoutAdminCounts());
    render(<ProjectStatsGrid />);
    for (const title of ["Media", "Field Groups", "Users", "Security"]) {
      expect(screen.queryByText(title), title).toBeNull();
    }
    expect(screen.queryByText("0")).toBeNull();
    // The figures it may read are still drawn.
    expect(screen.getByText("Entries")).toBeInTheDocument();
    expect(screen.getByText("Singles")).toBeInTheDocument();
  });
});

describe("the content statistics grid", () => {
  it("draws the media figure when it is given", () => {
    answers(FULL);
    render(<ContentStatsGrid />);
    expect(screen.getByText("Media Assets")).toBeInTheDocument();
  });

  it("leaves out the media figure when it is not given, rather than drawing 0", () => {
    answers(withoutAdminCounts());
    render(<ContentStatsGrid />);
    expect(screen.queryByText("Media Assets")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText("Total Entries")).toBeInTheDocument();
  });
});
