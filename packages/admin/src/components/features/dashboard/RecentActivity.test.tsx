import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
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
    timestamp: "2025-01-10T10:00:00Z",
    relativeTime: "2 hours ago",
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
    timestamp: "2025-01-10T09:30:00Z",
    relativeTime: "3 hours ago",
  },
];

describe("RecentActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("displays relative timestamps", async () => {
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
      expect(screen.getByText("2 hours ago")).toBeInTheDocument();
      expect(screen.getByText("3 hours ago")).toBeInTheDocument();
    });
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
});
