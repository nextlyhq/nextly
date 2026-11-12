/**
 * The Users page header offers the user fields screen beside "Create User",
 * and only to a reader that screen's route admits: the screen has no entry in
 * the Settings panel, so this action is the way to it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { holdsPermission } from "@admin/lib/permissions/holds-permission";
import { routeConfig } from "@admin/pages/registry";

import UsersPage from "./index";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));
vi.mock("./components/UserTable", () => ({ default: () => null }));
vi.mock("@admin/components/features/user-management/breadcrumbs", () => ({
  UserBreadcrumbs: () => null,
}));

function holding(...slugs: string[]) {
  vi.mocked(useCurrentUserPermissions).mockReturnValue({
    // Asked as the product asks it.
    hasPermission: (slug: string) => holdsPermission(new Set(slugs), slug),
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

/** The grant the user fields route demands, read from the route table. */
const fieldsGrant = routeConfig[ROUTES.USERS_FIELDS]?.requiredPermission;

describe("the Users page header", () => {
  it("reads the grant from a route that declares a single one", () => {
    // The premise of the cases below: they hold exactly this grant.
    expect(typeof fieldsGrant).toBe("string");
  });

  it("offers Fields to a reader the user fields route admits, linking there", () => {
    holding("read-users", String(fieldsGrant));
    render(<UsersPage />);
    const fields = screen.getByRole("link", { name: "Fields" });
    expect(fields.getAttribute("href")).toBe("/admin/users/fields");
    expect(ROUTES.USERS_FIELDS).toBe("/admin/users/fields");
  });

  it("does not offer Fields to a reader that route refuses", () => {
    holding("read-users");
    render(<UsersPage />);
    expect(screen.queryByRole("link", { name: "Fields" })).toBeNull();
    // The control: the header is drawn, its primary action with it.
    expect(screen.getByRole("link", { name: "Create User" })).toBeTruthy();
  });

  it("sits beside Create User, before it", () => {
    holding("read-users", String(fieldsGrant));
    render(<UsersPage />);
    const links = screen
      .getAllByRole("link")
      .map(link => link.textContent?.trim());
    expect(links.indexOf("Fields")).toBe(links.indexOf("Create User") - 1);
  });
});
