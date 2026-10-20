/**
 * The release list as a rendered screen: its tabs and their counts, what it
 * asks the server for, what a row says, its empty states, the single-document
 * filter and the row menu.
 *
 * The data hooks are stubbed, so what is under test is the screen's own
 * decisions: which question it sends, and how it lays out the answer. The
 * server's rule for which tab a release is in is tested where it lives.
 *
 * @module components/features/releases/__tests__/ReleaseList.test
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";

const mocks = vi.hoisted(() => ({
  listPage: vi.fn(),
  tabCounts: vi.fn(),
  readiness: vi.fn(),
  refetchCounts: vi.fn(),
  usersRead: vi.fn(),
  refetchList: vi.fn(),
  navigateTo: vi.fn(),
  setSearchParams: vi.fn(),
  searchParams: {} as Record<string, string>,
  can: vi.fn(),
}));

const idleMutation = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleaseListPage: (...args: unknown[]) => mocks.listPage(...args),
  useReleaseTabCounts: (...args: unknown[]) => mocks.tabCounts(...args),
  useReleasesReadiness: (ids: readonly string[], listReadAt: number) =>
    mocks.readiness(ids, listReadAt),
  useReleaseBlockers: () => ({ data: { items: [] }, isFetching: false }),
  useScheduleRelease: () => idleMutation,
  useCancelRelease: () => idleMutation,
  usePublishReleaseNow: () => idleMutation,
  useDeleteRelease: () => idleMutation,
}));
// Every users read the admin can make, watched: the table must make none.
vi.mock("@admin/services/userApi", () => ({
  getUserById: mocks.usersRead,
  fetchUsers: mocks.usersRead,
  userApi: { getUserById: mocks.usersRead, fetchUsers: mocks.usersRead },
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({
    user: { id: "u-me", name: "Mobeen Abdullah", email: "m@example.com" },
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (permission: string) => mocks.can(permission),
}));
vi.mock("@admin/hooks/useSearchParams", () => ({
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: mocks.navigateTo,
  setSearchParams: mocks.setSearchParams,
}));
// The reader is in New York, whatever zone the machine running this is in.
vi.mock("../release-timezone", async importOriginal => ({
  ...(await importOriginal<typeof import("../release-timezone")>()),
  readerZone: () => "America/New_York",
}));

import { ReleaseList } from "../ReleaseList";

const NO_CAPABILITIES = {
  schedule: false,
  cancel: false,
  addMember: false,
  removeMember: false,
  publishNow: false,
  update: false,
  delete: false,
};

function release(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    title: "Spring launch",
    description: "Homepage, pricing page and three launch posts",
    // 07:00 on 17 October in Karachi, 22:00 the evening before in New York.
    scheduledAt: "2026-10-17T02:00:00.000Z",
    timezone: "Asia/Karachi",
    state: "scheduled",
    kind: "release",
    publishedAt: null,
    createdBy: "u-me",
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    can: NO_CAPABILITIES,
    memberCounts: { total: 6, goLive: 5, comeDown: 1 },
    ...over,
  };
}

function page(items: unknown[], total = items.length, readAt = 1) {
  return {
    dataUpdatedAt: readAt,
    data: { items, meta: { total, hasNext: false } },
    isPending: false,
    isError: false,
    isFetching: false,
  };
}

function counts(
  over: Partial<Record<"upcoming" | "attention" | "drafts" | "done", number>>
) {
  return {
    counts: { upcoming: 0, attention: 0, drafts: 0, done: 0, ...over },
    isPending: false,
    isError: false,
  };
}

/** The page's readiness read, answering each id asked with these problems. */
function readinessAnswering(
  entry: (releaseId: string) => Record<string, unknown>
) {
  return (ids: readonly string[]) => ({
    isError: false,
    data: { items: ids.map(entry) },
  });
}

const ONE_DOCUMENT_TO_FIX = (releaseId: string) => ({
  releaseId,
  checked: true,
  // One document with two problems is one document to fix.
  hard: [{ memberId: "m2" }, { memberId: "m2" }],
  soft: [],
});

/** The desktop table; the narrow card view renders the same rows beside it. */
function table() {
  return within(screen.getByRole("table"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchParams = {};
  mocks.can.mockReturnValue(true);
  mocks.listPage.mockReturnValue(page([release()]));
  mocks.tabCounts.mockReturnValue(
    counts({ upcoming: 3, attention: 1, drafts: 2, done: 12 })
  );
  mocks.readiness.mockImplementation(readinessAnswering(ONE_DOCUMENT_TO_FIX));
});

describe("the release list's tabs", () => {
  it("shows the four tabs, each with its count", () => {
    render(<ReleaseList />);
    expect(screen.getByRole("tab", { name: "Upcoming (3)" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Needs attention (1)" })
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Drafts (2)" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Done (12)" })).toBeTruthy();
  });

  it("opens on Upcoming and asks for its first page of twenty", () => {
    render(<ReleaseList />);
    expect(
      screen
        .getByRole("tab", { name: "Upcoming (3)" })
        .getAttribute("aria-selected")
    ).toBe("true");
    expect(mocks.listPage).toHaveBeenLastCalledWith({
      tab: "upcoming",
      page: 1,
      limit: 25,
    });
  });

  it("opens the tab the address names, narrowed to the part it names", () => {
    mocks.searchParams = { tab: "attention", reason: "overdue" };
    render(<ReleaseList />);
    expect(mocks.listPage).toHaveBeenLastCalledWith({
      tab: "attention",
      page: 1,
      limit: 25,
      reason: "overdue",
    });
    expect(screen.getByText(/Showing only overdue releases/)).toBeTruthy();
  });

  it("ignores a reason carried onto a tab that has no parts", () => {
    mocks.searchParams = { tab: "drafts", reason: "overdue" };
    render(<ReleaseList />);
    expect(mocks.listPage).toHaveBeenLastCalledWith({
      tab: "drafts",
      page: 1,
      limit: 25,
    });
  });

  it("moves to another tab through the address, dropping the narrowing", async () => {
    const user = userEvent.setup();
    render(<ReleaseList />);
    await user.click(screen.getByRole("tab", { name: "Drafts (2)" }));
    expect(mocks.setSearchParams).toHaveBeenCalledWith({
      tab: "drafts",
      reason: null,
    });
  });
});

describe("a release's row", () => {
  it("says when it runs in the reader's zone, and as scheduled where that differs", () => {
    render(<ReleaseList />);
    const row = table();
    expect(row.getByText(/Fri, Oct 16, 2026 10:00\sPM/)).toBeTruthy();
    expect(row.getByText(/your time/)).toBeTruthy();
    expect(
      row.getByText(/Sat, Oct 17, 2026 7:00\sAM Asia\/Karachi/)
    ).toBeTruthy();
  });

  it("says what it does, how many documents are ready, its state and its owner", () => {
    render(<ReleaseList />);
    const row = table();
    expect(row.getByText(/6 documents/)).toBeTruthy();
    expect(row.getByText(/5 go live, 1 comes down/)).toBeTruthy();
    // One document with two problems is one document to fix.
    expect(row.getByText("5 of 6 ready")).toBeTruthy();
    expect(row.getByText("1 needs a fix")).toBeTruthy();
    expect(row.getByText("Scheduled")).toBeTruthy();
    expect(row.getByText("You")).toBeTruthy();
  });

  it("calls a scheduled release in Needs attention overdue, and a blocked one stopped", () => {
    mocks.searchParams = { tab: "attention" };
    mocks.listPage.mockReturnValue(
      page([
        release({ id: "a", title: "Late one" }),
        release({ id: "b", title: "Stuck one", state: "blocked" }),
      ])
    );
    render(<ReleaseList />);
    expect(table().getByText("Overdue")).toBeTruthy();
    expect(table().getByText("Stopped")).toBeTruthy();
  });

  it("describes a release that only takes documents down", () => {
    mocks.listPage.mockReturnValue(
      page([release({ memberCounts: { total: 2, goLive: 0, comeDown: 2 } })])
    );
    mocks.readiness.mockImplementation(
      readinessAnswering(releaseId => ({
        releaseId,
        checked: true,
        hard: [],
        soft: [],
      }))
    );
    render(<ReleaseList />);
    expect(table().getByText(/come down/)).toBeTruthy();
    expect(table().getByText(/2 documents/)).toBeTruthy();
    expect(table().queryByText(/go live/)).toBeNull();
    expect(table().getByText("All 2 ready")).toBeTruthy();
  });

  it("marks a single-document release", () => {
    mocks.listPage.mockReturnValue(
      page([release({ kind: "single", title: "Pricing page" })])
    );
    render(<ReleaseList />);
    expect(table().getByText("Single document")).toBeTruthy();
  });

  it("sends the reader to a release the page's read left unchecked", () => {
    mocks.readiness.mockImplementation(
      readinessAnswering(releaseId => ({
        releaseId,
        checked: false,
        reason: "over-member-limit",
      }))
    );
    render(<ReleaseList />);
    expect(table().getByText("Open to check")).toBeTruthy();
  });

  it("asks the readiness of the whole page in one read, for the rows with documents", () => {
    mocks.listPage.mockReturnValue(
      page([
        release({ id: "r1" }),
        release({
          id: "r2",
          title: "Empty one",
          memberCounts: { total: 0, goLive: 0, comeDown: 0 },
        }),
        release({ id: "r3", title: "Third" }),
      ])
    );
    render(<ReleaseList />);
    // Every render asks the same one question; never one per row.
    for (const [ids] of mocks.readiness.mock.calls) {
      expect(ids).toEqual(["r1", "r3"]);
    }
    expect(table().getAllByText("5 of 6 ready")).toHaveLength(2);
    expect(table().getByText("No documents yet")).toBeTruthy();
  });

  it("does not ask a finished release whether it is ready", () => {
    mocks.searchParams = { tab: "done" };
    mocks.listPage.mockReturnValue(
      page([
        release({
          state: "published",
          publishedAt: "2026-10-10T09:00:00.000Z",
        }),
      ])
    );
    render(<ReleaseList />);
    expect(table().getByText(/5 went live, 1 came down/)).toBeTruthy();
    expect(mocks.readiness).toHaveBeenLastCalledWith([], expect.any(Number));
  });

  it("names other people's releases from the list itself, with no users request", () => {
    mocks.listPage.mockReturnValue(
      page([
        release({
          id: "a",
          createdBy: "u-aqib",
          owner: { id: "u-aqib", name: "Aqib Qureshi" },
        }),
        release({
          id: "b",
          title: "Old one",
          createdBy: "u-sara",
          owner: { id: "u-sara", name: "Sara Malik" },
        }),
      ])
    );
    render(<ReleaseList />);
    expect(table().getByText("Aqib Qureshi")).toBeTruthy();
    expect(table().getByText("Sara Malik")).toBeTruthy();
    expect(mocks.usersRead).not.toHaveBeenCalled();
  });

  it("labels an owner who is gone as version history does", () => {
    mocks.listPage.mockReturnValue(
      page([release({ createdBy: "u-gone", owner: null })])
    );
    render(<ReleaseList />);
    expect(table().getByText("Author unavailable")).toBeTruthy();
    expect(mocks.usersRead).not.toHaveBeenCalled();
  });
});

describe("the row menu", () => {
  it("offers only what the server says this reader may do", async () => {
    const user = userEvent.setup();
    mocks.listPage.mockReturnValue(
      page([
        release({
          state: "draft",
          scheduledAt: null,
          can: {
            ...NO_CAPABILITIES,
            schedule: true,
            cancel: true,
            delete: true,
          },
        }),
      ])
    );
    render(<ReleaseList />);
    await user.click(table().getByRole("button", { name: "Row actions" }));
    expect(await screen.findByText("Schedule…")).toBeTruthy();
    expect(screen.getByText("Delete…")).toBeTruthy();
    // A draft that may be deleted is not also offered a discard.
    expect(screen.queryByText("Discard…")).toBeNull();
    expect(screen.queryByText("Publish now…")).toBeNull();
  });
  it("names each action for a scheduled release", async () => {
    const user = userEvent.setup();
    mocks.listPage.mockReturnValue(
      page([
        release({
          can: {
            ...NO_CAPABILITIES,
            schedule: true,
            publishNow: true,
            cancel: true,
          },
        }),
      ])
    );
    render(<ReleaseList />);
    await user.click(table().getByRole("button", { name: "Row actions" }));
    expect(await screen.findByText("Reschedule…")).toBeTruthy();
    expect(screen.getByText("Publish now…")).toBeTruthy();
    expect(screen.getByText("Cancel release…")).toBeTruthy();
    expect(screen.queryByText("Delete…")).toBeNull();
  });

  it("offers a draft that may not be deleted a discard instead", async () => {
    const user = userEvent.setup();
    mocks.listPage.mockReturnValue(
      page([
        release({
          state: "draft",
          scheduledAt: null,
          can: { ...NO_CAPABILITIES, cancel: true },
        }),
      ])
    );
    render(<ReleaseList />);
    await user.click(table().getByRole("button", { name: "Row actions" }));
    expect(await screen.findByText("Discard…")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });
});

describe("the list's empty states", () => {
  it.each([
    ["upcoming", "Nothing is scheduled"],
    ["attention", "Nothing needs attention"],
    ["drafts", "No drafts"],
    ["done", "Nothing has run yet"],
  ])("says what the %s tab holds when it is empty", (tab, title) => {
    mocks.searchParams = { tab };
    mocks.listPage.mockReturnValue(page([]));
    render(<ReleaseList />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers the drafts from an empty Upcoming when there are some to schedule", async () => {
    const user = userEvent.setup();
    mocks.listPage.mockReturnValue(page([]));
    render(<ReleaseList />);
    await user.click(screen.getByRole("button", { name: "View drafts" }));
    expect(mocks.setSearchParams).toHaveBeenCalledWith({
      tab: "drafts",
      reason: null,
    });
  });

  it("explains what a release is when there are none at all", () => {
    const onCreate = vi.fn();
    mocks.listPage.mockReturnValue(page([]));
    mocks.tabCounts.mockReturnValue(counts({}));
    render(<ReleaseList onCreate={onCreate} />);
    expect(
      screen.getByRole("heading", { name: "Plan your first release" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /New release/ })).toBeTruthy();
    // Nothing to search or filter yet.
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("a read that failed", () => {
  const failedCounts = () => ({
    counts: {
      upcoming: undefined,
      attention: undefined,
      drafts: undefined,
      done: undefined,
    },
    isPending: false,
    isError: true,
    refetch: mocks.refetchCounts,
  });

  it("shows the error with a retry on Needs attention, never 'Nothing needs attention'", async () => {
    const user = userEvent.setup();
    mocks.searchParams = { tab: "attention" };
    mocks.tabCounts.mockReturnValue(failedCounts());
    mocks.listPage.mockReturnValue({ ...page([]), refetch: mocks.refetchList });
    render(<ReleaseList />);
    expect(
      screen.queryByRole("heading", { name: "Nothing needs attention" })
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Plan your first release" })
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: /Try Again/ }));
    expect(mocks.refetchCounts).toHaveBeenCalled();
    expect(mocks.refetchList).toHaveBeenCalled();
  });

  it("keeps the rows a successful list read returned, with their controls", () => {
    mocks.searchParams = { tab: "attention" };
    mocks.tabCounts.mockReturnValue(failedCounts());
    mocks.listPage.mockReturnValue(page([release({ title: "Late one" })]));
    render(<ReleaseList />);
    expect(table().getByText("Late one")).toBeTruthy();
    expect(
      screen.getByPlaceholderText("Search by title or description")
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Hide single documents" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try Again/ })).toBeTruthy();
  });

  it("shows the error with a retry when the list read itself failed", () => {
    mocks.listPage.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: mocks.refetchList,
    });
    render(<ReleaseList />);
    expect(screen.getByRole("button", { name: /Try Again/ })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Nothing is scheduled" })
    ).toBeNull();
  });
});

describe("readiness while the page stays open", () => {
  it("asks again when the list polls, and shows a release that stopped being ready", () => {
    mocks.readiness.mockImplementation(
      readinessAnswering(releaseId => ({
        releaseId,
        checked: true,
        hard: [],
        soft: [],
      }))
    );
    mocks.listPage.mockReturnValue(page([release()], 1, 1000));
    const { rerender } = render(<ReleaseList />);
    expect(table().getByText("All 6 ready")).toBeTruthy();

    // The list polls and comes back with the same release; meanwhile one of
    // its documents lost a required field.
    mocks.readiness.mockImplementation(readinessAnswering(ONE_DOCUMENT_TO_FIX));
    mocks.listPage.mockReturnValue(page([release()], 1, 2000));
    rerender(<ReleaseList />);
    expect(mocks.readiness).toHaveBeenLastCalledWith(["r1"], 2000);
    expect(table().getByText("1 needs a fix")).toBeTruthy();
  });
});

describe("paging when a tab shrinks", () => {
  it("moves back to the last page when the only row on a later page goes", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 25 }, (_, i) =>
      release({ id: `r${i}`, title: `Release ${i}` })
    );
    let total = 26;
    mocks.listPage.mockImplementation(({ page: number }: { page: number }) =>
      number === 1 ? page(rows, total) : page([], total)
    );
    const { rerender } = render(<ReleaseList />);
    await user.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(mocks.listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    );

    // The only release on page 2 is published: the next answer (a poll, or
    // the refresh after the action) has one release fewer and no page 2.
    total = 25;
    rerender(<ReleaseList />);
    await waitFor(() =>
      expect(mocks.listPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 })
      )
    );
    expect(screen.getByText(/Showing 1.25 of 25/)).toBeTruthy();
  });
});

describe("the single-document filter", () => {
  it("hides single-document releases from the list and from the counts", async () => {
    const user = userEvent.setup();
    render(<ReleaseList />);
    await user.click(
      screen.getByRole("switch", { name: "Hide single documents" })
    );
    expect(mocks.listPage).toHaveBeenLastCalledWith({
      tab: "upcoming",
      page: 1,
      limit: 25,
      kind: "release",
    });
    expect(mocks.tabCounts).toHaveBeenLastCalledWith({
      search: "",
      kind: "release",
    });
  });

  it("says the filter, not the tab, is why nothing shows", async () => {
    const user = userEvent.setup();
    render(<ReleaseList />);
    mocks.listPage.mockReturnValue(page([]));
    await user.click(
      screen.getByRole("switch", { name: "Hide single documents" })
    );
    expect(
      screen.getByText(/Single-document releases are hidden/)
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show single documents" })
    ).toBeTruthy();
  });
});
