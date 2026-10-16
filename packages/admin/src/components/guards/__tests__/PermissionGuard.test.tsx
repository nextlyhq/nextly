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

import { PermissionGuard } from "../PermissionGuard";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

const mockPermissions = vi.mocked(useCurrentUserPermissions);

/** Only what the guard reads; the hook returns far more. */
function holding(slugs: string[], isLoading = false) {
  mockPermissions.mockReturnValue({
    hasPermission: (slug: string) => slugs.includes(slug),
    isLoading,
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
    function referredBy(url: string) {
      vi.spyOn(document, "referrer", "get").mockReturnValue(url);
    }

    it("goes back when the page was opened from the admin", () => {
      referredBy(here("/admin/collections/posts"));
      expect(clickGoBack()).toBe("back");
    });

    it("goes to the dashboard when the page was opened from the site", () => {
      referredBy(here("/"));
      vi.spyOn(window.history, "length", "get").mockReturnValue(3);
      expect(clickGoBack()).toBe("dashboard");
    });

    it("goes to the dashboard when another site's admin sent the user here", () => {
      referredBy("https://elsewhere.example/admin/collections/posts");
      expect(clickGoBack()).toBe("dashboard");
    });

    it("goes to the dashboard from a link opened in a fresh tab", () => {
      referredBy("");
      expect(clickGoBack()).toBe("dashboard");
    });
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
