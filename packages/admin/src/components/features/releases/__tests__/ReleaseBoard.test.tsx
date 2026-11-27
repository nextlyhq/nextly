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

import { fireEvent, render, screen, within } from "@admin/__tests__/utils";
import type {
  Release,
  ReleaseListParams,
  ReleaseListTab,
} from "@admin/types/releases";

const { fetchReleases, navigateTo } = vi.hoisted(() => ({
  fetchReleases: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock("@admin/services/releaseApi", async importOriginal => ({
  ...(await importOriginal<object>()),
  fetchReleases,
}));
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<object>()),
  navigateTo,
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: "me", name: "Ana Ruiz" } }),
}));
vi.mock("../release-timezone", async importOriginal => ({
  ...(await importOriginal<object>()),
  readerZone: () => "UTC",
}));

import { ReleaseBoard } from "../ReleaseBoard";
import { ReleaseTitleCell, SINGLES_HIDDEN_EMPTY } from "../ReleaseListCells";

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
      release({
        id: "r-hours",
        title: "Opening hours",
        kind: "single",
        state: "scheduled",
        scheduledAt: "2026-11-29T09:00:00.000Z",
        memberCounts: { total: 1, goLive: 1, comeDown: 0 },
      }),
    ],
    total: 2,
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
    // The server's kind filter: `release` leaves single-document releases
    // out of the page and out of the total alike.
    const left = answer.items.filter(
      each =>
        params.kind === undefined || (each.kind ?? "release") === params.kind
    );
    const total = answer.total - (answer.items.length - left.length);
    return {
      items: left.slice(0, params.limit ?? 20),
      meta: { total, hasNext: total > left.length },
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
    // Nothing on the board answers a drag: dropped on Done, the tile stays
    // in Scheduled and nothing is asked of the server.
    const asked = fetchReleases.mock.calls.length;
    const done = column(/^Done$/);
    fireEvent.dragStart(tile);
    fireEvent.dragEnter(done);
    fireEvent.dragOver(done);
    fireEvent.drop(done);
    fireEvent.dragEnd(tile);
    expect(
      within(column(/^Scheduled$/)).getByRole("link", { name: /Autumn launch/ })
    ).toBe(tile);
    expect(
      within(done).queryByRole("link", { name: /Autumn launch/ })
    ).toBeNull();
    expect(fetchReleases.mock.calls.length).toBe(asked);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("opens a release from its tile by click or by Enter", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    const tile = await screen.findByRole("link", { name: /Autumn launch/ });
    tile.focus();
    await userEvent.keyboard("{Enter}");
    expect(navigateTo).toHaveBeenLastCalledWith("/admin/releases/r-autumn");
    navigateTo.mockClear();
    await userEvent.click(screen.getByRole("link", { name: /Pricing update/ }));
    expect(navigateTo).toHaveBeenLastCalledWith("/admin/releases/r-pricing");
  });

  it("marks a single-document release as the list does, and no other", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    // The mark's words are part of the tile's name, so a screen reader hears
    // it as the list's row is heard.
    const single = await screen.findByRole("link", {
      name: /^Opening hours Single document\b/,
    });
    const mark = within(single).getByText("Single document");
    // The list's mark: the same words after the same icon, which no one
    // hears. Where each sits (its margin) is the surface's own.
    render(<ReleaseTitleCell release={release({ id: "x", kind: "single" })} />);
    const listMark = screen
      .getAllByText("Single document")
      .find(each => !single.contains(each));
    expect(mark.textContent).toBe(listMark?.textContent);
    expect(mark.querySelector("svg")?.outerHTML).toBe(
      listMark?.querySelector("svg")?.outerHTML
    );
    expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    const ordinary = screen.getByRole("link", { name: /Autumn launch/ });
    expect(within(ordinary).queryByText("Single document")).toBeNull();
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

describe("the Releases Board with single documents hidden", () => {
  it("leaves them out of every column, and out of the column's count", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} kind="release" />);

    await screen.findByText("Autumn launch");
    // Every column asks the server for ordinary releases only, so its count
    // is the count of what it shows and its "+N more" is true.
    const kinds = fetchReleases.mock.calls.map(
      ([params]) => (params as ReleaseListParams).kind
    );
    expect(kinds).toHaveLength(4);
    expect(new Set(kinds)).toEqual(new Set(["release"]));
    expect(screen.queryByText("Opening hours")).toBeNull();
    expect(screen.queryByText("Single document")).toBeNull();
    const scheduled = column(/^Scheduled$/);
    expect(within(scheduled).getAllByRole("link")).toHaveLength(1);
    expect(within(scheduled).getByText("1")).toBeInTheDocument();
  });

  it("shows them, marked, when nothing is hidden", async () => {
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    await screen.findByText("Opening hours");
    expect(
      fetchReleases.mock.calls.every(
        ([params]) => (params as ReleaseListParams).kind === undefined
      )
    ).toBe(true);
    expect(within(column(/^Scheduled$/)).getByText("2")).toBeInTheDocument();
  });

  it("says a column is empty because single documents are hidden, as the list says it", async () => {
    // Needs attention holds only a single-document release, so with them
    // hidden it is empty for that reason; Draft is empty either way.
    answers.attention = {
      items: [
        release({
          id: "r-lone",
          title: "Lone single",
          kind: "single",
          state: "blocked",
          scheduledAt: "2026-11-22T09:00:00.000Z",
          memberCounts: { total: 1, goLive: 1, comeDown: 0 },
        }),
      ],
      total: 1,
    };
    render(<ReleaseBoard onShowTab={vi.fn()} kind="release" />);

    // The list's own sentence, word for word.
    expect(SINGLES_HIDDEN_EMPTY).toBe(
      "Single-document releases are hidden, and there is nothing else here."
    );
    const attention = column(/^Needs attention$/);
    expect(
      await within(attention).findByText(SINGLES_HIDDEN_EMPTY)
    ).toBeInTheDocument();
    expect(within(attention).queryByText("Nothing here")).toBeNull();
  });

  it("says a column holds nothing when nothing is hidden", async () => {
    answers.attention = { items: [], total: 0 };
    render(<ReleaseBoard onShowTab={vi.fn()} />);

    const attention = column(/^Needs attention$/);
    expect(
      await within(attention).findByText("Nothing here")
    ).toBeInTheDocument();
    expect(within(attention).queryByText(SINGLES_HIDDEN_EMPTY)).toBeNull();
  });
});
