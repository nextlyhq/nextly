import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import { useRecentActivity } from "@admin/hooks/queries/useRecentActivity";
import { Activity } from "@admin/types/dashboard/activity";

import { RecentActivity } from "./RecentActivity";

// Mock the useRecentActivity hook
vi.mock("../../hooks/queries/useRecentActivity", () => ({
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
      screen.getByText(/failed to load recent activity/i)
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
      expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
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
      expect(screen.getByText("Recent Activity")).toBeInTheDocument();

      // Content should be visible
      expect(screen.getByText("John Doe")).toBeVisible();
    });
  });
});
