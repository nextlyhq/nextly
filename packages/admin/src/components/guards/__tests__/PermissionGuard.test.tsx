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

  it("goes back through history when there is somewhere to go back to", () => {
    holding([]);
    vi.spyOn(window.history, "length", "get").mockReturnValue(3);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(back).toHaveBeenCalledOnce();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("goes to the dashboard from a link opened in a fresh tab", () => {
    // A fresh tab has one history entry, so `back()` would do nothing and the
    // button would look broken.
    holding([]);
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(
      <PermissionGuard requiredPermission="read-posts" subject="collection">
        <Page />
      </PermissionGuard>
    );
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(back).not.toHaveBeenCalled();
    expect(mockNavigateTo).toHaveBeenCalledWith("/admin");
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
