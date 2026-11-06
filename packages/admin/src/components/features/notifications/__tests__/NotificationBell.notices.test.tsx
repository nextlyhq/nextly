/**
 * The bell's "For you" section: every admin user's own notices, with an unread
 * count on the bell, marked read once shown, and "Mark all read". The schema
 * change journal stays below it for super-admins alone.
 *
 * @module components/features/notifications/__tests__/NotificationBell.notices.test
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

vi.mock("@admin/services/journalApi", async () => {
  const actual = await vi.importActual<
    typeof import("@admin/services/journalApi")
  >("@admin/services/journalApi");
  return { ...actual, journalApi: { list: vi.fn() } };
});

vi.mock("../notices-api", () => ({
  noticesApi: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn() },
}));

import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { journalApi } from "@admin/services/journalApi";

import { NotificationBell } from "../NotificationBell";
import { noticesApi, type Notice } from "../notices-api";

const permissions = useCurrentUserPermissions as unknown as ReturnType<
  typeof vi.fn
>;
const journalList = journalApi.list as unknown as ReturnType<typeof vi.fn>;
const list = noticesApi.list as unknown as ReturnType<typeof vi.fn>;
const unreadCount = noticesApi.unreadCount as unknown as ReturnType<
  typeof vi.fn
>;
const markRead = noticesApi.markRead as unknown as ReturnType<typeof vi.fn>;

function wrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const notice = (id: string, title: string, read = false): Notice => ({
  id,
  kind: "releases.stopped",
  title,
  body: "It stopped before its time.",
  subject: {
    type: "release",
    id: `r-${id}`,
    link: `/admin/releases/r-${id}`,
    gone: false,
  },
  createdAt: "2026-11-04T09:00:00.000Z",
  readAt: read ? "2026-11-04T10:00:00.000Z" : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  journalList.mockResolvedValue({ rows: [], hasMore: false });
  list.mockResolvedValue({
    items: [
      notice("n1", "Autumn launch stopped"),
      notice("n2", "Spring sale ran late", true),
    ],
    meta: { total: 2, page: 1, limit: 20, hasNext: false },
  });
  unreadCount.mockResolvedValue(1);
  markRead.mockResolvedValue({ marked: 1 });
});

describe("the bell for a person who is not a super-admin", () => {
  beforeEach(() => {
    permissions.mockReturnValue({ isSuperAdmin: false, isLoading: false });
  });

  it("is shown, with their unread notices counted on it", async () => {
    render(<NotificationBell />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell-badge")).toHaveTextContent(
        "1"
      )
    );
  });

  it("lists their notices under For you, each linked, and no schema changes", async () => {
    render(<NotificationBell />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));

    expect(
      await screen.findByRole("heading", { name: "For you" })
    ).toBeInTheDocument();
    // The heading is drawn while the list is on its way, so the link is waited for.
    expect(
      await screen.findByRole("link", { name: /Autumn launch stopped/ })
    ).toHaveAttribute("href", "/admin/releases/r-n1");
    expect(screen.getByText("Spring sale ran late")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recent schema changes" })
    ).not.toBeInTheDocument();
  });

  it("marks the unread notices it showed as read, by id", async () => {
    render(<NotificationBell />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith({ ids: ["n1"] }));
  });

  it("marks every notice read on Mark all read", async () => {
    render(<NotificationBell />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    );

    await waitFor(() => expect(markRead).toHaveBeenCalledWith({ all: true }));
  });

  it("never asks for the schema-change journal, which is a super-admin's", async () => {
    render(<NotificationBell />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));
    await screen.findByRole("heading", { name: "For you" });

    expect(journalList).not.toHaveBeenCalled();
  });

  it("says so when there are no notices", async () => {
    list.mockResolvedValue({
      items: [],
      meta: { total: 0, page: 1, limit: 20, hasNext: false },
    });
    unreadCount.mockResolvedValue(0);
    render(<NotificationBell />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));

    expect(await screen.findByText("Nothing for you yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("notification-bell-badge")).toBeNull();
  });
});

describe("the bell for a super-admin", () => {
  it("shows For you above the schema changes", async () => {
    permissions.mockReturnValue({ isSuperAdmin: true, isLoading: false });
    render(<NotificationBell />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));

    const forYou = await screen.findByRole("heading", { name: "For you" });
    const journal = await screen.findByRole("heading", {
      name: "Recent schema changes",
    });
    expect(
      forYou.compareDocumentPosition(journal) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows For you and no schema changes where the builder is off", async () => {
    permissions.mockReturnValue({ isSuperAdmin: true, isLoading: false });
    journalList.mockResolvedValue({
      rows: [{ id: "j1", createdAt: "2026-11-04T09:00:00.000Z" }],
      hasMore: false,
    });
    render(<NotificationBell journalOffered={false} />, { wrapper: wrapper() });
    fireEvent.click(await screen.findByTestId("notification-bell"));

    expect(
      await screen.findByRole("heading", { name: "For you" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recent schema changes" })
    ).not.toBeInTheDocument();
    // Its count is the notices alone, and the journal is never asked for: it
    // is not this workspace's.
    expect(screen.getByTestId("notification-bell-badge")).toHaveTextContent(
      "1"
    );
    expect(journalList).not.toHaveBeenCalled();
  });
});
