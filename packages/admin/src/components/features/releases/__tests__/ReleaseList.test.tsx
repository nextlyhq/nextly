/**
 * The releases list, now rendered by the shared table.
 *
 * Written when the rows moved off hand-built cards onto `DataTableView` — the
 * same component entries, media, api keys, webhooks and deliveries use. A
 * migration like that fails quietly: the page still renders, the filters still
 * work, and the rows are simply gone or unreadable.
 *
 * @module components/features/releases/__tests__/ReleaseList.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { useReleasesMock, navigateToMock } = vi.hoisted(() => ({
  useReleasesMock: vi.fn(),
  navigateToMock: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleases: (...args: unknown[]) => useReleasesMock(...args),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: navigateToMock }));

import { ReleaseList } from "../ReleaseList";

const SCHEDULED = {
  id: "r1",
  title: "Autumn launch",
  description: null,
  scheduledAt: "2026-09-01T09:00:00.000Z",
  timezone: "Europe/Berlin",
  state: "scheduled",
  publishedAt: null,
};

const CANCELLED = {
  ...SCHEDULED,
  id: "r2",
  title: "Called off",
  state: "cancelled",
};

function answer(items: unknown[], over: Record<string, unknown> = {}) {
  return {
    data: { items, meta: { hasNext: false } },
    isPending: false,
    isError: false,
    ...over,
  };
}

beforeEach(() => {
  useReleasesMock.mockReset();
  navigateToMock.mockReset();
  useReleasesMock.mockReturnValue(answer([SCHEDULED, CANCELLED]));
});

describe("the releases list", () => {
  it("renders each release as a row in the shared table", async () => {
    render(<ReleaseList />);
    // A table, not a list of cards — which is the point of the migration.
    expect(screen.getByRole("table")).toBeTruthy();
    // `getAllBy`, because the shared table renders a desktop table AND a
    // narrow-screen view of the same rows; both are in the DOM.
    expect(screen.getAllByText("Autumn launch").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Called off").length).toBeGreaterThan(0);
  });

  it("shows the STATE beside each release, not just its title", async () => {
    // The state decides whether the rest of the row matters at all: a cancelled
    // launch and a scheduled one are different kinds of thing, and a list that
    // showed only titles would present them as the same thing.
    render(<ReleaseList />);
    expect(screen.getAllByText(/^scheduled$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^cancelled$/i).length).toBeGreaterThan(0);
  });

  it("keeps its own empty state rather than falling back to the table's", async () => {
    // The list short-circuits before the table when there is nothing to show,
    // and that is deliberate: an empty table saying "no rows" is worse here
    // than a panel explaining what a release IS and offering to create one.
    // Pinned because the migration could easily have dropped it.
    useReleasesMock.mockReturnValue(answer([]));
    render(<ReleaseList />);
    expect(screen.getByText(/nothing is scheduled/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
