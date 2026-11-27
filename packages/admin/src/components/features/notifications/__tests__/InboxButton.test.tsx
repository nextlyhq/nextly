/**
 * The Inbox: its button and name, the popover's parts and the tab it opens
 * on, its rows, and what marks an item read or unread.
 *
 * The admin's API client is replaced by a small server that holds each
 * person's items and their read state, and records every request. So "opening
 * the Inbox marks nothing read" is asked of the server's state, not of which
 * function was called, and "one request" is counted where requests leave.
 *
 * @module components/features/notifications/__tests__/InboxButton.test
 */
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  drawnText,
  nameHoldsDrawnText,
} from "@admin/__tests__/helpers/label-in-name";

import type { InboxTab, Notice } from "../notices-api";

const server = vi.hoisted(() => ({
  /** Each tab's items, newest first, as the server holds them. */
  items: { "for-you": [], alerts: [] } as Record<
    "for-you" | "alerts",
    Array<{
      id: string;
      kind: string;
      title: string;
      body?: string;
      subject: { type: string; id: string; link: string | null; gone: boolean };
      createdAt: string;
      readAt: string | null;
    }>
  >,
  /** Every request, as `GET /path` or `POST /path`. */
  asked: [] as string[],
}));

vi.mock("@admin/lib/api/protectedApi", () => {
  const tabs = ["for-you", "alerts"] as const;
  const all = () => tabs.flatMap(tab => server.items[tab]);
  /** One tab's items, or both tabs' where none is named. */
  const inTab = (tab: unknown) =>
    tab === "for-you" || tab === "alerts" ? server.items[tab] : all();
  const unread = (tab: string | null) =>
    inTab(tab).filter(item => item.readAt === null).length;
  const named = (body: Record<string, unknown>, id: string) =>
    Array.isArray(body.ids) && body.ids.includes(id);
  /** Read the named items, or every unread one in the tab, as the route does. */
  const markRead = (body: Record<string, unknown>): number => {
    const pool = body.all === true ? inTab(body.tab) : all();
    const marked = pool.filter(
      item =>
        item.readAt === null && (body.all === true || named(body, item.id))
    );
    for (const item of marked) item.readAt = new Date().toISOString();
    return marked.length;
  };
  /** Make the named read items unread again. */
  const markUnread = (body: Record<string, unknown>): number => {
    const marked = all().filter(
      item => item.readAt !== null && named(body, item.id)
    );
    for (const item of marked) item.readAt = null;
    return marked.length;
  };
  return {
    protectedApi: {
      get: vi.fn(async (path: string) => {
        server.asked.push(`GET ${path}`);
        const url = new URL(path, "https://admin.test");
        if (url.pathname === "/notices/count") {
          // One answer for the button and both tabs, as the route gives it.
          return { total: unread(null), alerts: unread("alerts") };
        }
        if (url.pathname === "/notices") {
          const tab = url.searchParams.get("tab");
          const items =
            tab === "for-you" || tab === "alerts" ? server.items[tab] : all();
          // Copies, as a real answer is: a later change on the server must
          // not reach an answer the admin already holds.
          return {
            items: items.map(entry => ({ ...entry })),
            meta: { total: items.length, page: 1, limit: 20, hasNext: false },
          };
        }
        if (url.pathname.startsWith("/schema/journal")) {
          return { rows: [{ id: "j1" }], hasMore: false };
        }
        throw new Error(`no such route: ${path}`);
      }),
      post: vi.fn(async (path: string, body: Record<string, unknown>) => {
        server.asked.push(`POST ${path}`);
        if (path === "/notices/read") return { marked: markRead(body) };
        if (path === "/notices/unread") return { marked: markUnread(body) };
        throw new Error(`no such route: ${path}`);
      }),
    },
  };
});

vi.mock("@admin/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@admin/components/ui")>(
    "@admin/components/ui"
  );
  return { ...actual, toast: { ...actual.toast, error: vi.fn() } };
});
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/lib/route-preload", () => ({ preloadRoute: vi.fn() }));
// A super admin where the builder runs: the person the schema journal was
// once shown to, so its absence here is not an accident of permissions.
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ isSuperAdmin: true, isLoading: false }),
}));

import { toast } from "@admin/components/ui";
import { protectedApi } from "@admin/lib/api/protectedApi";
import { navigateTo } from "@admin/lib/navigation";

import { InboxButton } from "../InboxButton";

const HOUR = 60 * 60 * 1000;

function item(
  id: string,
  title: string,
  options: {
    kind?: string;
    read?: boolean;
    link?: string | null;
    hoursAgo?: number;
  } = {}
): Notice {
  const link =
    options.link === undefined ? `/admin/things/${id}` : options.link;
  return {
    id,
    kind: options.kind ?? "workflows.assigned",
    title,
    subject: { type: "thing", id: `s-${id}`, link, gone: false },
    createdAt: new Date(
      Date.now() - (options.hoursAgo ?? 2) * HOUR
    ).toISOString(),
    readAt: options.read ? new Date().toISOString() : null,
  };
}

function fill(tab: InboxTab, items: Notice[]): void {
  server.items[tab] = items;
}

const unreadOnServer = (): number =>
  [...server.items["for-you"], ...server.items.alerts].filter(
    entry => entry.readAt === null
  ).length;

/**
 * A query client like the admin's, but for retries. `gcTime` is how long an
 * answer is kept once nothing shows it: none by default, so each test starts
 * clean; the admin keeps answers for minutes, which a test of what a reopened
 * Inbox reads must do too.
 */
function wrapper(gcTime = 0): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime, refetchOnWindowFocus: false },
    },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderInbox(gcTime?: number): void {
  render(<InboxButton />, { wrapper: wrapper(gcTime) });
}

/** The button, once the count is in. */
async function button(name: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole("button", { name });
}

async function openInbox(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId("inbox-button"));
  return screen.findByRole("tablist", { name: "Inbox" });
}

beforeEach(() => {
  server.items = { "for-you": [], alerts: [] };
  server.asked = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("the Inbox button", () => {
  it.each([
    { unread: 0, name: "Inbox", drawn: "" },
    { unread: 3, name: "Inbox, 3 unread", drawn: "3" },
    { unread: 12, name: "Inbox, 9+ unread", drawn: "9+" },
  ])(
    "is named $name with $unread unread, holding the count it draws",
    async ({ unread, name, drawn }) => {
      fill(
        "for-you",
        Array.from({ length: unread }, (_, n) => item(`n${n}`, `Item ${n}`))
      );
      renderInbox();
      await waitFor(() =>
        expect(screen.getByTestId("inbox-button")).toHaveAttribute(
          "aria-label",
          name
        )
      );
      const inbox = screen.getByTestId("inbox-button");
      expect(drawnText(inbox)).toBe(drawn);
      expect(nameHoldsDrawnText(name, drawnText(inbox))).toBe(true);
      // A tray, not a bell.
      expect(inbox.querySelector("svg.lucide-inbox")).not.toBeNull();
    }
  );

  it("asks only for the count until it is opened, and never for the schema journal", async () => {
    fill("for-you", [item("n1", "Spring launch was assigned to you")]);
    renderInbox();
    await button("Inbox, 1 unread");
    expect(server.asked).toEqual(["GET /notices/count?unread=true"]);

    await openInbox();
    await screen.findByText("Spring launch was assigned to you");
    // Opening asks the same count once more, for both tabs at once, and the
    // shown tab's items.
    expect(server.asked).toEqual([
      "GET /notices/count?unread=true",
      "GET /notices/count?unread=true",
      "GET /notices?tab=for-you&page=1&limit=20",
    ]);
    expect(server.asked.some(request => request.includes("journal"))).toBe(
      false
    );
    expect(screen.queryByText(/schema changes/i)).toBeNull();
  });

  it("asks for the count again, with one request, when the admin regains focus and every minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fill("for-you", [item("n1", "One")]);
    renderInbox();
    await button("Inbox, 1 unread");
    const counts = () =>
      server.asked.filter(request => request.startsWith("GET /notices/count"))
        .length;
    expect(counts()).toBe(1);

    // Read in another browser: this one learns it when it is looked at again.
    server.items["for-you"][0]!.readAt = new Date().toISOString();
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await button("Inbox");
    expect(counts()).toBe(2);

    fill("for-you", [item("n2", "Two")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await button("Inbox, 1 unread");
    expect(counts()).toBe(3);
    expect(
      server.asked.every(request => request.startsWith("GET /notices/count"))
    ).toBe(true);
  });

  it("keeps nothing in the browser's storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    fill("for-you", [
      item("n1", "Opened"),
      item("n2", "Read before", { read: true }),
    ]);
    renderInbox();
    await openInbox();
    fireEvent.click(await screen.findByRole("link", { name: /Opened/ }));
    await waitFor(() => expect(unreadOnServer()).toBe(0));
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    setItem.mockRestore();
  });
});

describe("the Inbox popover", () => {
  it("is headed Inbox, with Mark all read and two tabs, each with its unread count", async () => {
    fill("for-you", [item("n1", "One"), item("n2", "Two")]);
    fill("alerts", [
      item("a1", "Email isn't sending", { kind: "email.not-sending" }),
    ]);
    renderInbox();
    const tabs = await openInbox();
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeEnabled();
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map(tab => tab.textContent)
    ).toEqual(["For you 2 unread", "Alerts 1 unread"]);
  });

  it.each([
    { forYou: 1, alerts: 1, opens: "Alerts" },
    { forYou: 0, alerts: 1, opens: "Alerts" },
    { forYou: 1, alerts: 0, opens: "For you" },
    { forYou: 0, alerts: 0, opens: "For you" },
  ])(
    "opens on $opens with $forYou unread for you and $alerts unread alerts",
    async ({ forYou, alerts, opens }) => {
      fill("for-you", [item("n1", "Assigned", { read: forYou === 0 })]);
      fill("alerts", [
        item("a1", "Job failed", { kind: "jobs.failed", read: alerts === 0 }),
      ]);
      renderInbox();
      const tabs = await openInbox();
      expect(
        within(tabs).getByRole("tab", { selected: true })
      ).toHaveTextContent(opens);
    }
  );

  it("stays on the tab it opened on as its items are read", async () => {
    // Opened on Alerts for its one unread alert; reading that alert where it
    // is empties the Alerts count, and the person is still on Alerts.
    fill("for-you", [item("n1", "Assigned")]);
    fill("alerts", [
      item("a1", "Job failed", { kind: "jobs.failed", link: null }),
    ]);
    renderInbox();
    const tabs = await openInbox();
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent(
      "Alerts"
    );
    fireEvent.click(await screen.findByRole("button", { name: /Job failed/ }));
    await waitFor(() =>
      expect(
        within(tabs).getByRole("tab", { name: /Alerts/ })
      ).toHaveTextContent(/^Alerts$/)
    );
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent(
      "Alerts"
    );
  });

  it("shows each item's text, how long ago, and the area it came from, with an unread mark that is not color alone", async () => {
    fill("for-you", [
      item("n1", "“Spring launch” was assigned to you for review", {
        kind: "workflows.assigned",
        hoursAgo: 2,
      }),
      item("n2", "“Autumn sale” stopped", {
        kind: "releases.stopped",
        read: true,
        hoursAgo: 5,
      }),
    ]);
    renderInbox();
    await openInbox();
    const unread = await screen.findByRole("link", {
      name: /Spring launch/,
    });
    expect(unread).toHaveTextContent(
      "Unread: “Spring launch” was assigned to you for review"
    );
    expect(unread).toHaveTextContent("2h ago · Workflows");
    expect(within(unread).getByTestId("inbox-unread-dot")).toBeInTheDocument();
    expect(within(unread).getByText("Unread:")).toHaveClass("sr-only");

    const read = screen.getByRole("link", { name: /Autumn sale/ });
    expect(read).toHaveTextContent("5h ago · Releases");
    expect(read).not.toHaveTextContent("Unread");
    expect(within(read).queryByTestId("inbox-unread-dot")).toBeNull();
  });

  it.each([
    { tab: "For you", says: "Nothing for you right now." },
    { tab: "Alerts", says: "No alerts. Everything on the site is working." },
  ])("says so in words when $tab is empty", async ({ tab, says }) => {
    renderInbox();
    const tabs = await openInbox();
    fireEvent.mouseDown(within(tabs).getByRole("tab", { name: tab }));
    expect(await screen.findByText(says)).toBeInTheDocument();
  });

  it("marks nothing read when it opens over three unread items", async () => {
    fill("for-you", [
      item("n1", "One"),
      item("n2", "Two"),
      item("n3", "Three"),
    ]);
    renderInbox();
    await openInbox();
    await screen.findByText("Three");
    // Long enough for any effect that would mark what it shows.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(unreadOnServer()).toBe(3);
    expect(server.asked.some(request => request.startsWith("POST"))).toBe(
      false
    );
    expect(await button("Inbox, 3 unread")).toBeInTheDocument();
  });

  it("marks an item read when it is opened, and follows its link", async () => {
    fill("for-you", [
      item("n1", "One"),
      item("n2", "Two"),
      item("n3", "Three"),
    ]);
    renderInbox();
    await openInbox();
    fireEvent.click(await screen.findByRole("link", { name: /Two/ }));
    await waitFor(() => expect(unreadOnServer()).toBe(2));
    expect(
      server.items["for-you"].find(entry => entry.id === "n2")?.readAt
    ).not.toBeNull();
    expect(navigateTo).toHaveBeenCalledWith("/admin/things/n2");
    expect(await button("Inbox, 2 unread")).toBeInTheDocument();
  });

  it("marks an item with no link read where it is", async () => {
    fill("for-you", [item("n1", "Nowhere to go", { link: null })]);
    renderInbox();
    await openInbox();
    fireEvent.click(
      await screen.findByRole("button", { name: /Nowhere to go/ })
    );
    await waitFor(() => expect(unreadOnServer()).toBe(0));
    expect(navigateTo).not.toHaveBeenCalled();
    expect(screen.getByRole("tablist", { name: "Inbox" })).toBeInTheDocument();
  });

  it("offers Mark as unread in a read item's menu, and makes it unread on the server", async () => {
    const user = userEvent.setup();
    fill("for-you", [item("n1", "Read before", { read: true })]);
    renderInbox();
    await openInbox();
    await user.click(
      await screen.findByRole("button", {
        name: "More actions for Read before",
      })
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Mark as unread" })
    );
    await waitFor(() => expect(unreadOnServer()).toBe(1));
    expect(server.asked).toContain("POST /notices/unread");
    expect(await button("Inbox, 1 unread")).toBeInTheDocument();
  });

  it("puts focus on the row after Mark as unread, since the menu's button goes with the read state", async () => {
    const user = userEvent.setup();
    fill("for-you", [item("n1", "Read before", { read: true })]);
    renderInbox();
    await openInbox();
    const more = await screen.findByRole("button", {
      name: "More actions for Read before",
    });
    more.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: "Mark as unread" });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(unreadOnServer()).toBe(1));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More actions for Read before" })
      ).toBeNull()
    );
    expect(screen.getByRole("link", { name: /Read before/ })).toHaveFocus();
    expect(screen.getByRole("tablist", { name: "Inbox" })).toBeInTheDocument();
  });

  it("keeps the tab counts with the button's while it is open, when the admin regains focus", async () => {
    fill("for-you", [item("n1", "One"), item("n2", "Two")]);
    renderInbox();
    const tabs = await openInbox();
    await waitFor(() =>
      expect(
        within(tabs).getByRole("tab", { name: /For you/ })
      ).toHaveTextContent("For you 2 unread")
    );

    // Read in another browser while this Inbox stays open.
    server.items["for-you"][0]!.readAt = new Date().toISOString();
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await button("Inbox, 1 unread");
    expect(
      within(tabs).getByRole("tab", { name: /For you/ })
    ).toHaveTextContent("For you 1 unread");
  });

  it("marks every unread item in the tab shown read, and none in the other", async () => {
    fill("for-you", [item("n1", "One"), item("n2", "Two")]);
    fill("alerts", [item("a1", "Job failed", { kind: "jobs.failed" })]);
    renderInbox();
    const tabs = await openInbox();
    fireEvent.mouseDown(within(tabs).getByRole("tab", { name: /For you/ }));
    await screen.findByText("Two");
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() =>
      expect(
        server.items["for-you"].every(entry => entry.readAt !== null)
      ).toBe(true)
    );
    expect(server.items.alerts[0]!.readAt).toBeNull();
  });

  it("works from the keyboard: a tab list, rows reached and opened with Enter, focus back on the button when it closes", async () => {
    const user = userEvent.setup();
    fill("for-you", [item("n1", "Assigned to you")]);
    fill("alerts", [
      item("a1", "Job failed", { kind: "jobs.failed", read: true }),
    ]);
    renderInbox();
    const inbox = await button("Inbox, 1 unread");
    inbox.focus();
    await user.keyboard("{Enter}");
    const tabs = await screen.findByRole("tablist", { name: "Inbox" });

    // Into the tab list, across it with the arrows.
    const selected = within(tabs).getByRole("tab", { selected: true });
    expect(selected).toHaveTextContent("For you");
    selected.focus();
    await user.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent(
      "Alerts"
    );
    await user.keyboard("{ArrowLeft}");
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent(
      "For you"
    );

    // On to the row, and Enter opens it.
    const row = await screen.findByRole("link", { name: /Assigned to you/ });
    await user.tab();
    if (document.activeElement !== row) await user.tab();
    expect(row).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(unreadOnServer()).toBe(0));
    expect(navigateTo).toHaveBeenCalledWith("/admin/things/n1");

    // Opened again and closed with Escape: focus is back on the button.
    await user.click(screen.getByTestId("inbox-button"));
    await screen.findByRole("tablist", { name: "Inbox" });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("tablist", { name: "Inbox" })).toBeNull()
    );
    expect(screen.getByTestId("inbox-button")).toHaveFocus();
  });

  it("is a dialog named Inbox", async () => {
    renderInbox();
    await openInbox();
    expect(screen.getByRole("dialog", { name: "Inbox" })).toBeInTheDocument();
  });

  it("opens on Alerts for an alert that arrived since it was last opened", async () => {
    // The Alerts count is asked for afresh on each opening, so one kept from
    // the last opening, a moment ago, does not choose the tab.
    const user = userEvent.setup();
    fill("for-you", [item("n1", "Assigned")]);
    renderInbox(Number.POSITIVE_INFINITY);
    let tabs = await openInbox();
    expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent(
      "For you"
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(tabs).not.toBeInTheDocument());

    fill("alerts", [item("a1", "Job failed", { kind: "jobs.failed" })]);
    tabs = await openInbox();
    await waitFor(() =>
      expect(
        within(tabs).getByRole("tab", { selected: true })
      ).toHaveTextContent("Alerts")
    );
  });

  it("keeps focus on Mark all read once there is nothing left to mark", async () => {
    const user = userEvent.setup();
    fill("for-you", [item("n1", "One")]);
    renderInbox();
    await openInbox();
    await screen.findByText("One");
    const markAll = screen.getByRole("button", { name: "Mark all read" });
    markAll.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(unreadOnServer()).toBe(0));
    await waitFor(() =>
      expect(markAll).toHaveAttribute("aria-disabled", "true")
    );
    expect(markAll).toHaveFocus();
    // Unavailable, it marks nothing more.
    await user.keyboard("{Enter}");
    expect(
      server.asked.filter(request => request === "POST /notices/read")
    ).toHaveLength(1);
  });

  it("marks an item read when it is opened in a new browser tab with a middle click", async () => {
    fill("for-you", [item("n1", "One"), item("n2", "Two")]);
    renderInbox();
    await openInbox();
    const row = await screen.findByRole("link", { name: /Two/ });
    fireEvent(row, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    await waitFor(() => expect(unreadOnServer()).toBe(1));
    expect(
      server.items["for-you"].find(entry => entry.id === "n2")?.readAt
    ).not.toBeNull();
  });

  it("says so when a mark does not reach the server, and leaves the item as it was", async () => {
    fill("for-you", [item("n1", "One")]);
    renderInbox();
    await openInbox();
    vi.mocked(protectedApi.post).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(await screen.findByRole("link", { name: /One/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      "Your Inbox could not be updated",
      expect.objectContaining({ description: expect.any(String) })
    );
    expect(unreadOnServer()).toBe(1);
  });

  it("shows what the server holds after a mark whose answer was lost, and never claims nothing changed", async () => {
    // No link, so opening it keeps the Inbox open to show the row.
    fill("for-you", [item("n1", "One", { link: null }), item("n2", "Two")]);
    renderInbox();
    await button("Inbox, 2 unread");
    await openInbox();
    // The server makes the change, then the answer never arrives.
    const post = vi.mocked(protectedApi.post);
    const real = post.getMockImplementation()!;
    post.mockImplementationOnce(async (path, body) => {
      await real(path, body);
      throw new Error("the connection closed before the answer");
    });
    fireEvent.click(await screen.findByRole("button", { name: /One/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(unreadOnServer()).toBe(1);
    // The Inbox reads the server again, so the count and the row agree with it.
    expect(await button("Inbox, 1 unread")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^One/ })
      ).not.toHaveTextContent("Unread")
    );
    const [, options] = vi.mocked(toast.error).mock.calls[0]!;
    expect(String(options?.description)).not.toMatch(/nothing was changed/i);
  });

  it("says the Inbox could not be loaded when its first read of the rows fails", async () => {
    fill("for-you", [item("n1", "One")]);
    const get = vi.mocked(protectedApi.get);
    const real = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => {
      if (path.startsWith("/notices?")) throw new Error("offline");
      return real(path);
    });
    try {
      renderInbox();
      await openInbox();
      expect(
        await screen.findByText("Your Inbox could not be loaded.", undefined, {
          timeout: 4_000,
        })
      ).toBeInTheDocument();
    } finally {
      get.mockImplementation(real);
    }
  });

  it("keeps the rows it has when a later refresh of them fails", async () => {
    fill("for-you", [item("n1", "One"), item("n2", "Two")]);
    renderInbox();
    await openInbox();
    await screen.findByRole("link", { name: /One/ });

    // The next reads of the list fail, as a dropped connection would.
    const get = vi.mocked(protectedApi.get);
    const real = get.getMockImplementation()!;
    try {
      get.mockImplementation(async (path: string) => {
        if (path.startsWith("/notices?")) throw new Error("offline");
        return real(path);
      });
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() =>
        expect(
          get.mock.calls.filter(([path]) =>
            String(path).startsWith("/notices?")
          ).length
        ).toBeGreaterThan(1)
      );
      // Retried once by the hook, then settled as failed.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 1_500));
      });
      expect(screen.getByRole("link", { name: /One/ })).toBeInTheDocument();
      expect(screen.queryByText("Your Inbox could not be loaded.")).toBeNull();
    } finally {
      get.mockImplementation(real);
    }
  });

  it("brings an open Inbox's rows up to date with its counts when the admin regains focus", async () => {
    fill("for-you", [item("n1", "One"), item("n2", "Two")]);
    renderInbox();
    await openInbox();
    expect(await screen.findByRole("link", { name: /One/ })).toHaveTextContent(
      "Unread"
    );

    // Read in another browser while this Inbox stays open.
    server.items["for-you"][0]!.readAt = new Date().toISOString();
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await button("Inbox, 1 unread");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /One/ })).not.toHaveTextContent(
        "Unread"
      )
    );
    // Read now, so its menu offers Mark as unread.
    expect(
      screen.getByRole("button", { name: "More actions for One" })
    ).toBeInTheDocument();
  });
});
