/**
 * The Releases Board: the list's four tabs as columns, read-only.
 *
 * A release changes column by itself when its moment passes or its run stops,
 * so the board offers no dragging between columns: a drag that scheduled or
 * published would be a launch made by accident. Each column shows its first
 * releases, the true count, and the way to the rest in the List view.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type {
  Release,
  ReleaseListParams,
  ReleaseListTab,
} from "@admin/types/releases";

const { fetchReleases } = vi.hoisted(() => ({ fetchReleases: vi.fn() }));

vi.mock("@admin/services/releaseApi", async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchReleases,
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: "me", name: "Ana Ruiz" } }),
}));
vi.mock("../release-timezone", async importOriginal => ({
  ...(await importOriginal<object>()),
  readerZone: () => "UTC",
}));

import { ReleaseBoard } from "../ReleaseBoard";

function release(over: Partial<Release> & { id: string }): Release {
  return {
    title: over.id,
    description: null,
    scheduledAt: null,
    timezone: null,
    state: "draft",
    memberCounts: { total: 3, goLive: 3, comeDown: 0 },
    owner: { id: "u2", name: "Sam Okafor" },
    publishedAt: null,
    createdBy: "u2",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    ...over,
  };
}

/** Each tab's releases and its true total, as the list answers. */
const answers: Record<ReleaseListTab, { items: Release[]; total: number }> = {
  drafts: { items: [], total: 0 },
  upcoming: { items: [], total: 0 },
  attention: { items: [], total: 0 },
  done: { items: [], total: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  answers.drafts = {
    items: [
      release({ id: "r-pricing", title: "Pricing update", createdBy: "me" }),
    ],
    total: 1,
  };
  answers.upcoming = {
    items: [
      release({
        id: "r-autumn",
        title: "Autumn launch",
        state: "scheduled",
        scheduledAt: "2026-11-28T09:00:00.000Z",
        memberCounts: { total: 14, goLive: 14, comeDown: 0 },
      }),
    ],
    total: 1,
  };
  answers.attention = {
    items: [
      release({
        id: "r-banner",
        title: "Black Friday banner",
        state: "blocked",
        scheduledAt: "2026-11-22T09:00:00.000Z",
        memberCounts: { total: 1, goLive: 1, comeDown: 0 },
      }),
    ],
    total: 1,
  };
  answers.done = {
    items: Array.from({ length: 8 }, (_, i) =>
      release({
        id: `r-done-${i}`,
        title: `Newsletter ${i}`,
        state: "published",
        publishedAt: "2026-10-31T09:00:00.000Z",
      })
    ),
    total: 12,
  };
  fetchReleases.mockImplementation(async (params: ReleaseListParams) => {
    const answer = answers[params.tab as ReleaseListTab];
    return {
      items: answer.items.slice(0, params.limit ?? 20),
      meta: {
        total: answer.total,
        hasNext: answer.total > answer.items.length,
      },
    };
  });
});

const column = (name: RegExp) => screen.getByRole("region", { name });

describe("the Releases Board", () => {
  it("shows the list's four tabs as columns, in the order a release moves through them", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    await screen.findByText("Autumn launch");
    expect(
      screen
        .getAllByRole("region")
        .map(region => region.getAttribute("aria-label"))
    ).toEqual(["Draft", "Scheduled", "Needs attention", "Done"]);
    // Each column's count is the tab's true total, not the releases drawn.
    expect(within(column(/^Done$/)).getByText("12")).toBeInTheDocument();
    // Asked as the list asks, one tab at a time, a few releases each.
    const asked = fetchReleases.mock.calls.map(
      ([params]) =>
        `${(params as ReleaseListParams).tab}:${(params as ReleaseListParams).limit}`
    );
    expect(asked.sort()).toEqual([
      "attention:8",
      "done:8",
      "drafts:8",
      "upcoming:8",
    ]);
  });

  it("names each release with when it moves, its documents and its owner, and opens it", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    const tile = await screen.findByRole("link", { name: /Autumn launch/ });
    expect(tile).toHaveAttribute("href", "/admin/releases/r-autumn");
    expect(tile).toHaveTextContent(/Goes live .*(28 Nov|Nov 28)/);
    expect(tile).toHaveTextContent("14 documents · Sam Okafor");
    // The reader's own release is theirs, as the list says it.
    expect(
      await screen.findByRole("link", { name: /Pricing update/ })
    ).toHaveTextContent("3 documents · You");
  });

  it("says why a release needs attention, and how a finished one ended", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    expect(
      await screen.findByRole("link", { name: /Black Friday banner/ })
    ).toHaveTextContent("Stopped");
    expect(
      (await screen.findAllByRole("link", { name: /Newsletter/ }))[0]
    ).toHaveTextContent(/Went live .*(31 Oct|Oct 31)/);
  });

  it("leads from a full column to the rest of its tab in the list", async () => {
    const onShowTab = vi.fn();
    render(<ReleaseBoard onShowTab={onShowTab} />);

    await screen.findByText("Newsletter 0");
    expect(within(column(/^Done$/)).getAllByRole("link")).toHaveLength(8);
    await userEvent.click(
      within(column(/^Done$/)).getByRole("button", { name: "+4 more" })
    );
    expect(onShowTab).toHaveBeenCalledWith("done");
    // A column showing all it holds offers no more.
    expect(
      within(column(/^Scheduled$/)).queryByRole("button", { name: /more/ })
    ).toBeNull();
  });

  it("says a column is empty rather than leaving a blank", async () => {
    answers.attention = { items: [], total: 0 };
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    expect(
      await within(column(/^Needs attention$/)).findByText("Nothing here")
    ).toBeInTheDocument();
  });

  it("offers no dragging: a release changes column by itself", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    const tile = await screen.findByRole("link", { name: /Autumn launch/ });
    expect(tile).not.toHaveAttribute("draggable", "true");
    expect(tile.closest("[draggable='true']")).toBeNull();
  });

  it("says when a column could not be read, and reads it again", async () => {
    let failing = true;
    fetchReleases.mockImplementation(async (params: ReleaseListParams) => {
      if (params.tab === "upcoming" && failing) throw new Error("offline");
      const answer = answers[params.tab as ReleaseListTab];
      return {
        items: answer.items,
        meta: { total: answer.total, hasNext: false },
      };
    });
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    const scheduled = column(/^Scheduled$/);
    await within(scheduled).findByText("These releases could not be loaded.");
    failing = false;
    await userEvent.click(
      within(scheduled).getByRole("button", { name: "Try again" })
    );
    expect(
      await within(scheduled).findByText("Autumn launch")
    ).toBeInTheDocument();
  });
});

describe("the Releases Board, kept current", () => {
  it("reads every column again on the fast cadence, an empty one too", async () => {
    // A release crossing its moment leaves Scheduled for Needs attention;
    // read on the slow cadence, an empty Needs attention would keep it off
    // the board for minutes.
    answers.attention = { items: [], total: 0 };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<ReleaseBoard onShowTab={vi.fn()} />);
      await screen.findByText("Autumn launch");
      const asked = (tab: string) =>
        fetchReleases.mock.calls.filter(
          ([params]) => (params as ReleaseListParams).tab === tab
        ).length;
      const before = asked("attention");

      await vi.advanceTimersByTimeAsync(61_000);

      expect(asked("attention")).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
