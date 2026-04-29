// F10 PR 5 — NotificationBell component tests.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

vi.mock("@admin/services/journalApi", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/services/journalApi")
  >("@admin/services/journalApi");
  return {
    ...actual,
    journalApi: { list: vi.fn() },
  };
});

import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { journalApi } from "@admin/services/journalApi";
import type { JournalRow } from "@admin/services/journalApi";

import { LAST_SEEN_KEY } from "../useUnreadCount";

import { NotificationBell } from "../NotificationBell";

const mockedPermissions = useCurrentUserPermissions as unknown as ReturnType<
  typeof vi.fn
>;
const mockedList = journalApi.list as unknown as ReturnType<typeof vi.fn>;

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function rowAt(id: string, startedAt: string): JournalRow {
  return {
    id,
    source: "ui",
    status: "success",
    scope: { kind: "collection", slug: "posts" },
    summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
    startedAt,
    endedAt: startedAt,
    durationMs: 100,
    errorCode: null,
    errorMessage: null,
  };
}

beforeEach(() => {
  mockedPermissions.mockReset();
  mockedList.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NotificationBell", () => {
  it("renders nothing when permissions are still loading", () => {
    mockedPermissions.mockReturnValue({
      isSuperAdmin: false,
      isLoading: true,
    });
    mockedList.mockResolvedValue({ rows: [], hasMore: false });

    const { container } = render(<NotificationBell />, {
      wrapper: makeWrapper(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the user is not a super-admin", () => {
    mockedPermissions.mockReturnValue({
      isSuperAdmin: false,
      isLoading: false,
    });
    mockedList.mockResolvedValue({ rows: [], hasMore: false });

    const { container } = render(<NotificationBell />, {
      wrapper: makeWrapper(),
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the bell button (without badge) for a super-admin with no unread rows", async () => {
    localStorage.setItem(LAST_SEEN_KEY, "2030-01-01T00:00:00.000Z");
    mockedPermissions.mockReturnValue({
      isSuperAdmin: true,
      isLoading: false,
    });
    mockedList.mockResolvedValue({
      rows: [rowAt("a", "2026-04-30T10:00:00.000Z")],
      hasMore: false,
    });

    render(<NotificationBell />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("notification-bell-badge")
    ).not.toBeInTheDocument();
  });

  it("renders the badge when unread rows exist", async () => {
    mockedPermissions.mockReturnValue({
      isSuperAdmin: true,
      isLoading: false,
    });
    mockedList.mockResolvedValue({
      rows: [
        rowAt("a", "2026-04-30T10:00:00.000Z"),
        rowAt("b", "2026-04-30T09:00:00.000Z"),
      ],
      hasMore: false,
    });

    render(<NotificationBell />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("notification-bell-badge")).toBeInTheDocument();
    });
    expect(screen.getByTestId("notification-bell-badge").textContent).toBe("2");
  });

  it("clamps badge text to '9+' when more than 9 unread", async () => {
    mockedPermissions.mockReturnValue({
      isSuperAdmin: true,
      isLoading: false,
    });
    mockedList.mockResolvedValue({
      rows: Array.from({ length: 12 }, (_, i) =>
        rowAt(`id-${i}`, new Date(2026, 3, 30, 10, 0, 12 - i).toISOString())
      ),
      hasMore: false,
    });

    render(<NotificationBell />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("notification-bell-badge").textContent).toBe(
        "9+"
      );
    });
  });

  it("clicking the bell opens the popover and marks all rows as seen", async () => {
    mockedPermissions.mockReturnValue({
      isSuperAdmin: true,
      isLoading: false,
    });
    mockedList.mockResolvedValue({
      rows: [
        rowAt("a", "2026-04-30T10:00:00.000Z"),
        rowAt("b", "2026-04-30T09:00:00.000Z"),
      ],
      hasMore: false,
    });

    render(<NotificationBell />, { wrapper: makeWrapper() });

    // Wait for badge to appear.
    await waitFor(() => {
      expect(screen.getByTestId("notification-bell-badge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("notification-bell"));

    await waitFor(() => {
      expect(localStorage.getItem(LAST_SEEN_KEY)).toBe(
        "2026-04-30T10:00:00.000Z"
      );
    });

    // Badge clears after click.
    await waitFor(() => {
      expect(
        screen.queryByTestId("notification-bell-badge")
      ).not.toBeInTheDocument();
    });
  });

  it("sets aria-label including unread count when unread > 0", async () => {
    mockedPermissions.mockReturnValue({
      isSuperAdmin: true,
      isLoading: false,
    });
    mockedList.mockResolvedValue({
      rows: [rowAt("a", "2026-04-30T10:00:00.000Z")],
      hasMore: false,
    });

    render(<NotificationBell />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("notification-bell")).toHaveAttribute(
        "aria-label",
        "Recent schema changes (1 unread)"
      );
    });
  });
});
