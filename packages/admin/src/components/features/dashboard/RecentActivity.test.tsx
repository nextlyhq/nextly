import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import { useRecentActivity } from "@admin/hooks/queries/useRecentActivity";
import { Activity } from "@admin/types/dashboard/activity";

import { RecentActivity } from "./RecentActivity";

// Mocked through the SAME specifier the component imports. A relative path
// from here resolves to `src/components/hooks/...`, which does not exist, so
// the mock registered against a module nobody loads: the real hook stayed in
// place and `vi.mocked()` wrapped a plain function, leaving every case below
// asserting nothing.
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
      // Asserted against what the component actually renders. These three
      // expectations had drifted from the copy years of edits moved on from,
      // and the broken mock meant nothing ever noticed.
      screen.getByText(/failed to fetch activity stream/i)
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

  it("has correct accessibility structure", async () => {
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
      // Header should be present
      expect(screen.getByText("System Event Log")).toBeInTheDocument();

      // Content should be visible
      expect(screen.getByText("John Doe")).toBeVisible();
    });
  });
});
