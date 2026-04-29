// F10 PR 5 — NotificationDropdown component tests.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { JournalRow } from "@admin/services/journalApi";

vi.mock("@admin/services/journalApi", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/services/journalApi")
  >("@admin/services/journalApi");
  return {
    ...actual,
    journalApi: {
      list: vi.fn(),
    },
  };
});

import { journalApi } from "@admin/services/journalApi";

import { NotificationDropdown } from "../NotificationDropdown";

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
  mockedList.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NotificationDropdown", () => {
  it("shows a loading state while the query is in-flight", () => {
    mockedList.mockImplementation(() => new Promise(() => undefined));
    render(<NotificationDropdown />, { wrapper: makeWrapper() });
    expect(
      screen.getByTestId("notification-dropdown-loading")
    ).toBeInTheDocument();
  });

  it("renders the empty state when zero rows return", async () => {
    mockedList.mockResolvedValueOnce({ rows: [], hasMore: false });
    render(<NotificationDropdown />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        screen.getByTestId("notification-dropdown-empty")
      ).toBeInTheDocument();
    });
    expect(screen.getByText("No schema changes yet.")).toBeInTheDocument();
  });

  it("renders a list of rows when the query resolves", async () => {
    mockedList.mockResolvedValueOnce({
      rows: [
        rowAt("a", "2026-04-30T10:00:00.000Z"),
        rowAt("b", "2026-04-30T09:00:00.000Z"),
      ],
      hasMore: false,
    });
    render(<NotificationDropdown />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        screen.getByTestId("notification-dropdown-list")
      ).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("notification-row")).toHaveLength(2);
    expect(
      screen.queryByTestId("notification-dropdown-load-more")
    ).not.toBeInTheDocument();
  });

  it("shows the 'Load more' button when hasMore is true and appends rows on click", async () => {
    // First page (React Query)
    mockedList.mockResolvedValueOnce({
      rows: [rowAt("a", "2026-04-30T10:00:00.000Z")],
      hasMore: true,
    });
    // Second page (manual call from loadMore)
    mockedList.mockResolvedValueOnce({
      rows: [rowAt("b", "2026-04-30T09:00:00.000Z")],
      hasMore: false,
    });

    render(<NotificationDropdown />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        screen.getByTestId("notification-dropdown-load-more")
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("notification-dropdown-load-more"));

    await waitFor(() => {
      expect(screen.getAllByTestId("notification-row")).toHaveLength(2);
    });

    // After consuming the second page, hasMore=false → button disappears.
    expect(
      screen.queryByTestId("notification-dropdown-load-more")
    ).not.toBeInTheDocument();
  });

  it("'Load more' uses the oldest visible row's startedAt as the cursor", async () => {
    mockedList.mockResolvedValueOnce({
      rows: [
        rowAt("a", "2026-04-30T10:00:00.000Z"),
        rowAt("b", "2026-04-30T09:00:00.000Z"),
      ],
      hasMore: true,
    });
    mockedList.mockResolvedValueOnce({ rows: [], hasMore: false });

    render(<NotificationDropdown />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        screen.getByTestId("notification-dropdown-load-more")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("notification-dropdown-load-more"));

    await waitFor(() => {
      // Second call uses `before = oldest row's startedAt`.
      expect(mockedList).toHaveBeenLastCalledWith({
        limit: 20,
        before: "2026-04-30T09:00:00.000Z",
      });
    });
  });

  it("renders an error state when the query fails and Retry triggers refetch", async () => {
    // useJournal sets retry: 1 — so one retry happens before the
    // error surfaces. Reject both to trigger error state, then
    // succeed on the manual refetch click.
    mockedList.mockRejectedValueOnce(new Error("network down"));
    mockedList.mockRejectedValueOnce(new Error("network down again"));
    mockedList.mockResolvedValueOnce({ rows: [], hasMore: false });

    render(<NotificationDropdown />, { wrapper: makeWrapper() });

    await waitFor(
      () => {
        expect(
          screen.getByTestId("notification-dropdown-error")
        ).toBeInTheDocument();
      },
      { timeout: 5000 }
    );

    fireEvent.click(screen.getByText("Try again"));

    await waitFor(() => {
      expect(
        screen.getByTestId("notification-dropdown-empty")
      ).toBeInTheDocument();
    });
  });

  it("shows an inline error if the 'Load more' fetch fails", async () => {
    mockedList.mockResolvedValueOnce({
      rows: [rowAt("a", "2026-04-30T10:00:00.000Z")],
      hasMore: true,
    });
    mockedList.mockRejectedValueOnce(new Error("503 service unavailable"));

    render(<NotificationDropdown />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(
        screen.getByTestId("notification-dropdown-load-more")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("notification-dropdown-load-more"));

    await waitFor(() => {
      expect(screen.getByText(/503 service unavailable/)).toBeInTheDocument();
    });

    // Original row stays rendered; user can retry without losing context.
    expect(screen.getAllByTestId("notification-row")).toHaveLength(1);
  });
});
