/**
 * A refusal is said, on the page that was asked for, and never turned into a
 * silent trip to the dashboard.
 *
 * Every case that refuses also asserts that nothing navigated: the old guard
 * rendered nothing and redirected, so a test that looked only for the message
 * would pass against a guard that shows it for one frame and then leaves.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { forgetEntryBehind, recordPushFrom } from "@admin/lib/admin-history";

import { PermissionGuard } from "../PermissionGuard";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

const mockPermissions = vi.mocked(useCurrentUserPermissions);

/**
 * Only what the guard reads; the hook returns far more. The server's answer
 * about collections agrees with the slugs unless `server` says otherwise.
 */
function holding(
  slugs: string[],
  isLoading = false,
  server: {
    allows?: string[];
    content?: {
      isLoading?: boolean;
      hasAnswer?: boolean;
      isPlaceholder?: boolean;
      error?: Error;
    };
  } = {}
) {
  const allows = server.allows ?? slugs;
  mockPermissions.mockReturnValue({
    hasPermission: (slug: string) => slugs.includes(slug),
    canAccessCollection: (slug: string, action: string) =>
      allows.includes(`${action}-${slug}`),
    isLoading,
    hasAnswer: !isLoading,
    error: null,
    content: {
      isLoading: server.content?.isLoading ?? isLoading,
      hasAnswer: server.content?.hasAnswer ?? !isLoading,
      error: server.content?.error ?? null,
      isPlaceholder: server.content?.isPlaceholder ?? false,
    },
    retry: vi.fn(),
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

/** A URL on the page's own origin, whatever port the test environment uses. */
const here = (path: string) => new URL(path, window.location.origin).href;

const pageRendered = vi.fn();
function Page() {
  pageRendered();
  return <span>the page</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetEntryBehind();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PermissionGuard", () => {
  it("renders the page for a user holding the permission", () => {
    holding(["read-posts"]);
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    expect(screen.getByText("the page")).toBeTruthy();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("says a collection is out of reach, and stays on the page", () => {
    holding([]);
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    expect(
      screen.getByRole("heading", {
        name: "You don't have access to this collection",
      })
    ).toBeTruthy();
    expect(pageRendered).not.toHaveBeenCalled();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("says a Single is out of reach", () => {
    holding([]);
    render(
      <PermissionGuard requiredPermission="read-homepage" subject="single">
        <Page />
      </PermissionGuard>
    );
    expect(
      screen.getByRole("heading", {
        name: "You don't have access to this Single",
      })
    ).toBeTruthy();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("falls back to 'this page' for any other route", () => {
    holding([]);
    render(
      <PermissionGuard requiredPermission="read-users">
        <Page />
      </PermissionGuard>
    );
    expect(
      screen.getByRole("heading", {
        name: "You don't have access to this page",
      })
    ).toBeTruthy();
  });

  it("names no role and no permission", () => {
    // A user may hold several roles, and a permission slug is an internal
    // spelling: the message reads the same whatever the account holds.
    holding([]);
    const { container } = render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    // The refusal must be on screen, or the absences below hold trivially.
    expect(
      screen.getByRole("heading", { name: /don't have access/ })
    ).toBeTruthy();
    expect(container.textContent).not.toContain("read-posts");
    expect(container.textContent).not.toMatch(/\brole\b/i);
  });

  it("goes to the dashboard only when asked", () => {
    holding([]);
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    expect(mockNavigateTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Go to dashboard" }));
    expect(mockNavigateTo).toHaveBeenCalledWith("/admin");
  });

  /**
   * Click Go back on a refusal and report where it went: through history, or
   * to the dashboard.
   */
  function clickGoBack(): "back" | "dashboard" | "nowhere" {
    holding([]);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    if (back.mock.calls.length > 0) return "back";
    return mockNavigateTo.mock.calls.some(([path]) => path === "/admin")
      ? "dashboard"
      : "nowhere";
  }

  describe("where the browser has the Navigation API", () => {
    // jsdom has none, so each case defines one and the cleanup removes it.
    // `entries()` lists this origin's entries only, as browsers do.
    function previousEntry(url: string | null) {
      const entries =
        url === null
          ? [{ url: here("/admin/collections/tags"), index: 0 }]
          : [
              { url, index: 0 },
              { url: here("/admin/collections/tags"), index: 1 },
            ];
      Object.defineProperty(window, "navigation", {
        value: {
          // A browser reports this too, true for ANY same-origin entry
          // behind; the site's pages count, so it alone cannot decide.
          canGoBack: entries.length > 1,
          currentEntry: entries[entries.length - 1],
          entries: () => entries,
        },
        configurable: true,
      });
    }
    afterEach(() => {
      Reflect.deleteProperty(window, "navigation");
    });

    it("goes back to the admin page before", () => {
      previousEntry(here("/admin/collections/posts"));
      expect(clickGoBack()).toBe("back");
    });

    it("goes to the dashboard when the page before is the site, not the admin", () => {
      // The admin shares its origin with the site it runs in, so a link
      // followed from the site's own pages leaves a same-origin entry behind
      // that is not the admin. Back would take the user out of it.
      previousEntry(here("/"));
      expect(clickGoBack()).toBe("dashboard");
    });

    it("reads the path by segment, so a sibling of /admin is not the admin", () => {
      previousEntry(here("/administrator"));
      expect(clickGoBack()).toBe("dashboard");
    });

    it("goes to the dashboard when nothing of this site came before", () => {
      // A fresh tab, the new-tab page or another site: none of them is in
      // this origin's entries, so the refusal is the first.
      previousEntry(null);
      vi.spyOn(window.history, "length", "get").mockReturnValue(3);
      expect(clickGoBack()).toBe("dashboard");
    });
  });

  describe("where the browser has no Navigation API", () => {
    // Only a move the router itself saw proves an entry to go back to. The
    // referrer names the page a link was followed from, which says nothing
    // about whether this tab has an entry behind it.
    function referredBy(url: string) {
      vi.spyOn(document, "referrer", "get").mockReturnValue(url);
    }

    it("goes back after a move inside the admin, though the referrer is the site", () => {
      referredBy(here("/"));
      recordPushFrom("/admin/collections/posts");
      expect(clickGoBack()).toBe("back");
    });

    it("goes to the dashboard after a move in from the site, though the referrer is the admin", () => {
      referredBy(here("/admin/collections/posts"));
      recordPushFrom("/");
      expect(clickGoBack()).toBe("dashboard");
    });

    it("goes to the dashboard from an admin link opened in a new tab", () => {
      // The new tab names the admin page as its referrer yet has no entry
      // behind it, so back() would do nothing.
      referredBy(here("/admin/collections/posts"));
      vi.spyOn(window.history, "length", "get").mockReturnValue(1);
      expect(clickGoBack()).toBe("dashboard");
    });

    it("goes to the dashboard when nothing was seen, whatever the history holds", () => {
      referredBy("");
      vi.spyOn(window.history, "length", "get").mockReturnValue(3);
      expect(clickGoBack()).toBe("dashboard");
    });
  });

  describe("when the permissions could not be loaded", () => {
    // No answer is not a refusal: telling a super-admin they lack access
    // because a request failed would be a claim nothing supports.
    function failing(answered: { slugs: string[] } | null) {
      const retry = vi.fn();
      mockPermissions.mockReturnValue({
        hasPermission: (slug: string) =>
          answered?.slugs.includes(slug) ?? false,
        isLoading: false,
        hasAnswer: answered !== null,
        error: new Error("Request failed"),
        content: { isLoading: false, hasAnswer: false, error: null },
        retry,
      } as unknown as ReturnType<typeof useCurrentUserPermissions>);
      return retry;
    }

    it("says the access check failed, offers a retry, and claims no refusal", () => {
      const retry = failing(null);
      render(
        <PermissionGuard requiredPermission="read-posts" subject="collection">
          <Page />
        </PermissionGuard>
      );
      expect(screen.getByText("Couldn't check your access")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: /don't have access/ })).toBe(
        null
      );
      expect(pageRendered).not.toHaveBeenCalled();
      expect(mockNavigateTo).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(retry).toHaveBeenCalledOnce();
    });

    it("keeps an earlier answer's refusal when only a later refresh failed", () => {
      // A refetch that fails keeps the last answer, which is still a decision.
      failing({ slugs: [] });
      render(
        <PermissionGuard requiredPermission="read-posts" subject="collection">
          <Page />
        </PermissionGuard>
      );
      expect(
        screen.getByRole("heading", {
          name: "You don't have access to this collection",
        })
      ).toBeTruthy();
    });

    it("keeps an earlier answer's grant when only a later refresh failed", () => {
      failing({ slugs: ["read-posts"] });
      render(
        <PermissionGuard requiredPermission="read-posts" subject="collection">
          <Page />
        </PermissionGuard>
      );
      expect(screen.getByText("the page")).toBeTruthy();
    });
  });

  describe("on a collection or Single route", () => {
    const POSTS = { slug: "posts", action: "read" } as const;

    it("refuses what the server refuses, though the role holds the permission", () => {
      // The collection's code rule refuses the read the role's slug allows.
      holding(["read-posts"], false, { allows: [] });
      render(
        <PermissionGuard
          requiredPermission="read-posts"
          subject="collection"
          entity={POSTS}
        >
          <Page />
        </PermissionGuard>
      );
      expect(
        screen.getByRole("heading", {
          name: "You don't have access to this collection",
        })
      ).toBeTruthy();
      expect(pageRendered).not.toHaveBeenCalled();
    });

    it("opens what the server allows", () => {
      holding([], false, { allows: ["read-posts"] });
      render(
        <PermissionGuard
          requiredPermission="read-posts"
          subject="collection"
          entity={POSTS}
        >
          <Page />
        </PermissionGuard>
      );
      expect(screen.getByText("the page")).toBeTruthy();
    });

    it("opens what the server's answer allows, though the permission list failed", () => {
      mockPermissions.mockReturnValue({
        hasPermission: () => false,
        canAccessCollection: (slug: string, action: string) =>
          `${action}-${slug}` === "read-posts",
        isLoading: false,
        hasAnswer: false,
        error: new Error("Request failed"),
        content: { isLoading: false, hasAnswer: true, error: null },
        retry: vi.fn(),
      } as unknown as ReturnType<typeof useCurrentUserPermissions>);
      render(
        <PermissionGuard
          requiredPermission="read-posts"
          subject="collection"
          entity={POSTS}
        >
          <Page />
        </PermissionGuard>
      );
      expect(screen.getByText("the page")).toBeTruthy();
    });

    it("keeps the page it opened on screen while the next language's answer is on its way", () => {
      // The language moved from allowed the page; the new one's answer is not
      // in yet. The page stays mounted, its writes held by the editor, rather
      // than swapped for a spinner or a refusal nothing supports.
      holding([], false, { allows: ["read-posts"] });
      const guarded = (
        <PermissionGuard
          requiredPermission="read-posts"
          subject="collection"
          entity={POSTS}
        >
          <Page />
        </PermissionGuard>
      );
      const { rerender } = render(guarded);
      expect(screen.getByText("the page")).toBeTruthy();

      holding([], false, {
        allows: [],
        content: { hasAnswer: false, isPlaceholder: true },
      });
      rerender(guarded);
      expect(screen.getByText("the page")).toBeTruthy();
      expect(
        screen.queryByRole("heading", {
          name: "You don't have access to this collection",
        })
      ).toBeNull();
    });

    it("opens no page on the answer for the language moved from", () => {
      // A route this guard never opened waits for its own language's answer,
      // as on a first visit.
      holding([], false, {
        allows: [],
        content: { hasAnswer: false, isPlaceholder: true },
      });
      render(
        <PermissionGuard
          requiredPermission="read-posts"
          subject="collection"
          entity={POSTS}
        >
          <Page />
        </PermissionGuard>
      );
      expect(screen.getByText("Setting up your workspace")).toBeTruthy();
      expect(pageRendered).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("heading", {
          name: "You don't have access to this collection",
        })
      ).toBeNull();
    });

    it("claims no refusal while the server's answer is missing", () => {
      holding(["read-posts"], false, {
        allows: [],
        content: { hasAnswer: false, error: new Error("Request failed") },
      });
      render(
        <PermissionGuard
          requiredPermission="read-posts"
          subject="collection"
          entity={POSTS}
        >
          <Page />
        </PermissionGuard>
      );
      expect(screen.getByText("Couldn't check your access")).toBeTruthy();
      expect(pageRendered).not.toHaveBeenCalled();
    });
  });

  it("opens a system page while only the answer about collections is missing", () => {
    // A content-registry failure says nothing about the users page, which
    // the permission list decides.
    holding(["read-users"], false, {
      content: { hasAnswer: false, error: new Error("Request failed") },
    });
    render(
      <PermissionGuard requiredPermission="read-users">
        <Page />
      </PermissionGuard>
    );
    expect(screen.getByText("the page")).toBeTruthy();
  });

  it("shows neither the page nor the refusal while permissions load", () => {
    holding([], true);
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    expect(pageRendered).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /don't have access/ })).toBe(
      null
    );
  });
});
