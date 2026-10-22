import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";
import { useRecentActivity } from "@admin/hooks/queries/useRecentActivity";
import { Activity } from "@admin/types/dashboard/activity";

import { RecentActivity } from "./RecentActivity";

// Mocked through the same specifier the component imports. A relative path
// from this directory resolves to `src/components/hooks/...`, which does not
// exist, and a mock registered against a module nobody loads leaves the real
// hook in place.
vi.mock("@admin/hooks/queries/useRecentActivity", () => ({
  useRecentActivity: vi.fn(),
}));

const mockUseRecentActivity = vi.mocked(useRecentActivity);

/**
 * The instant the tests pretend it is when the card is first read.
 *
 * The fixtures are anchored to it rather than carrying fixed dates, because the
 * label under test is a function of NOW: hard-coded timestamps drift further
 * into the past every day the suite runs, so an assertion on "2h ago" would
 * pass today and fail forever after.
 */
const READ_AT = new Date("2026-03-01T12:00:00Z");

function hoursBefore(instant: Date, hours: number): string {
  return new Date(instant.getTime() - hours * 60 * 60 * 1000).toISOString();
}

const mockActivities: Activity[] = [
  {
    id: "1",
    user: {
      id: "u1",
      name: "John Doe",
      email: "john@example.com",
      avatar: "https://i.pravatar.cc/150?img=1",
      initials: "JD",
      // A live author: the component renders the name as given. An erased
      // actor arrives with `deleted: true` and a placeholder name instead.
      deleted: false,
    },
    type: "create",
    action: "created",
    target: "new user account",
    category: "success",
    timestamp: hoursBefore(READ_AT, 2),
    count: 1,
    countAtLeast: false,
  },
  {
    id: "2",
    user: {
      id: "u2",
      name: "Jane Smith",
      email: "jane@example.com",
      avatar: "https://i.pravatar.cc/150?img=2",
      initials: "JS",
      // Live as well, so neither fixture exercises the erased rendering.
      deleted: false,
    },
    type: "update",
    action: "updated",
    target: "role permissions",
    category: "info",
    timestamp: hoursBefore(READ_AT, 3),
    count: 1,
    countAtLeast: false,
  },
];

describe("RecentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says how many saves a row stands for, in its text and in what a screen reader hears", () => {
    const repeated: Activity = {
      ...mockActivities[1]!,
      id: "3",
      target: "Site style",
      entryTitle: "Site style",
      count: 12,
    };
    const floor: Activity = {
      ...repeated,
      id: "4",
      count: 1000,
      countAtLeast: true,
    };
    mockUseRecentActivity.mockReturnValue({
      data: {
        activities: [repeated, floor, mockActivities[0]!],
        hasMore: false,
      },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    const rows = screen
      .getAllByText(/Jane Smith|John Doe/)
      .map(name => name.closest("p"));
    /** The row's text without what `hidden` matches, spaced as it reads. */
    const without = (row: Element | null | undefined, hidden: string) => {
      const copy = row?.cloneNode(true) as Element | undefined;
      copy?.querySelectorAll(hidden).forEach(node => node.remove());
      return (copy?.textContent ?? "").replace(/\s+/g, " ").replace(/ ,/g, ",");
    };
    // Seen: the dot and the count. Heard: a comma and the count, no dot.
    expect(without(rows[0], ".sr-only")).toContain("Site style · 12 times");
    expect(without(rows[0], '[aria-hidden="true"]')).toContain(
      "Site style, 12 times"
    );
    expect(without(rows[1], '[aria-hidden="true"]')).toContain(
      "Site style, 1000+ times"
    );
    // A single save says nothing about a count.
    expect(rows[2]?.textContent).not.toMatch(/times/);
  });

  it("draws a floor even at one save, and nothing for an activity built without a count", () => {
    // The walk can stop inside a run it has read one save of: "1+", not "1".
    const floorOfOne: Activity = {
      ...mockActivities[1]!,
      id: "5",
      target: "Site style",
      entryTitle: "Site style",
      count: 1,
      countAtLeast: true,
    };
    // Built elsewhere, a sign-in say, with neither count field.
    const built: Activity = {
      id: "6",
      user: mockActivities[0]!.user,
      type: "login",
      action: "signed in",
      target: "the admin",
      category: "info",
      timestamp: hoursBefore(READ_AT, 4),
    };
    mockUseRecentActivity.mockReturnValue({
      data: { activities: [floorOfOne, built], hasMore: false },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    const rows = screen
      .getAllByText(/Jane Smith|John Doe/)
      .map(name => name.closest("p"));
    expect(rows[0]?.textContent).toContain("1+ times");
    expect(rows[1]?.textContent).not.toMatch(/times/);
  });

  it("renders loading state", () => {
    mockUseRecentActivity.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      isError: false,
      isSuccess: false,
      status: "pending",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    // Check for loading spinner with aria-label
    expect(screen.getByLabelText(/loading/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    const error = new Error("Failed to fetch");
    mockUseRecentActivity.mockReturnValue({
      data: undefined,
      isLoading: false,
      error,
      isError: true,
      isSuccess: false,
      status: "error",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    expect(
      // The copy the error branch renders.
      screen.getByText(/couldn't load recent activity/i)
    ).toBeInTheDocument();
  });

  it("renders empty state when no activities", async () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: [] },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as unknown as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    await waitFor(() => {
      expect(
        screen.getByText(/activity log is currently silent/i)
      ).toBeInTheDocument();
    });
  });

  it("renders activities successfully", async () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
      expect(screen.getByText(/created/i)).toBeInTheDocument();
      expect(screen.getByText(/updated/i)).toBeInTheDocument();
    });
  });

  it("passes custom limit prop to hook", () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity limit={10} />);

    expect(mockUseRecentActivity).toHaveBeenCalledWith(10);
  });

  it("uses default limit of 5", () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    expect(mockUseRecentActivity).toHaveBeenCalledWith(5);
  });

  /*
   * 🔴 The label tracks the clock WITHOUT anything re-rendering the card, and
   * that is the whole property. Deriving it at render instead of at fetch was
   * only half the repair: a render has to happen for the derivation to run, and
   * a dashboard card nobody touches gets none -- so an entry fetched as "just
   * now" kept that wording for as long as the page stayed open, the same wrong
   * label reached by a different route.
   *
   * The earlier version of this test called `rerender` itself, which is
   * precisely what production has nothing to do. It went green on an
   * implementation that could not update on its own. Here the ONLY thing that
   * happens between the two assertions is time passing.
   */
  it("advances each label as time passes, with nothing re-rendering it", async () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(READ_AT);
      render(<RecentActivity />);

      await waitFor(() => {
        expect(screen.getByText("2h ago")).toBeInTheDocument();
        expect(screen.getByText("3h ago")).toBeInTheDocument();
      });

      // Three hours pass. No refetch, no rerender, no interaction -- only the
      // card's own clock.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
      });

      await waitFor(() => {
        expect(screen.getByText("5h ago")).toBeInTheDocument();
        expect(screen.getByText("6h ago")).toBeInTheDocument();
      });
      expect(screen.queryByText("2h ago")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("displays activity badges with correct variants", async () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    await waitFor(() => {
      // Check that activities are rendered
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    });
  });

  it("names its own region, since the grid frames it with no chrome", async () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    await waitFor(() => {
      // Asked by ACCESSIBLE NAME rather than by the heading's text, because the
      // card declares `chrome: "none"` and so owns its own labelled region --
      // `getByText` would still pass on a heading that labels nothing.
      expect(
        screen.getByRole("region", { name: "Recent activity" })
      ).toBeInTheDocument();

      expect(screen.getByText("John Doe")).toBeVisible();
    });
  });

  /*
   * 🔴 Both controls existed and neither worked: a "Detailed Log" link whose
   * href was the dashboard the card sits on, and a "Sync Previous Events"
   * button with no handler. Asserted as ABSENCE OF ANY link or button rather
   * than of those two strings, because the defect is a control that promises a
   * destination this feed does not have -- re-adding one under a different
   * label is the same defect and a string match would pass it.
   */
  it("offers no navigation or pagination control", async () => {
    mockUseRecentActivity.mockReturnValue({
      data: { activities: mockActivities },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    // The control: the rows must have rendered, or an empty card would satisfy
    // the two absence assertions below without the feed ever having drawn.
    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeVisible();
    });

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("heads a Single's row by its label, with no collection beside it", async () => {
    // A collection's entry draws its collection as a chip after the title; a
    // Single's row has no collection, and drawing its slug there would name
    // one that does not exist. The collection row is the control: it shows
    // the chip draws when there is something to draw.
    const base = mockActivities[1]!;
    mockUseRecentActivity.mockReturnValue({
      data: {
        activities: [
          {
            ...base,
            id: "s",
            target: "Site Settings",
            entryTitle: "Site Settings",
          },
          {
            ...base,
            id: "c",
            target: "Hello in posts",
            entryTitle: "Hello",
            collectionLabel: "posts",
          },
        ],
      },
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as ReturnType<typeof useRecentActivity>);

    render(<RecentActivity />);

    const single = await screen.findByText("Site Settings");
    const singleLine = single.closest("p");
    expect(singleLine?.textContent).not.toContain("site-settings");
    expect(singleLine?.querySelectorAll("span")).toHaveLength(3);
    const collectionLine = screen.getByText("Hello").closest("p");
    expect(collectionLine?.textContent).toContain("posts");
    expect(collectionLine?.querySelectorAll("span")).toHaveLength(4);
  });
});
