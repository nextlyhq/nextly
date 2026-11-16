/**
 * The user fields pages open only to a reader who holds their Settings grant
 * AND may see users: the route's guard asks the first, `UserFieldsGuard`
 * inside it asks the second, as the route renders them.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionGuard } from "@admin/components/guards/PermissionGuard";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { READ_SETTINGS } from "@admin/lib/permissions/system-policy";

import { UserFieldsGuard } from "../user-fields-guard";

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

const mockPermissions = vi.mocked(useCurrentUserPermissions);

/** Only what the guard reads; the hook returns far more. */
function holding(slugs: string[]) {
  mockPermissions.mockReturnValue({
    hasPermission: (slug: string) => slugs.includes(slug),
    canAccessCollection: () => false,
    isLoading: false,
    hasAnswer: true,
    error: null,
    content: {
      isLoading: false,
      hasAnswer: true,
      error: null,
      isPlaceholder: false,
    },
    retry: vi.fn(),
  } as unknown as ReturnType<typeof useCurrentUserPermissions>);
}

/** The user fields route as the router renders it. */
function renderRoute() {
  render(
    <PermissionGuard requiredPermission={READ_SETTINGS}>
      <UserFieldsGuard>
        <span>the user fields page</span>
      </UserFieldsGuard>
    </PermissionGuard>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the user fields pages", () => {
  it("open with the Settings grant and read-users together", () => {
    holding([READ_SETTINGS, "read-users"]);
    renderRoute();
    expect(screen.getByText("the user fields page")).toBeInTheDocument();
  });

  it("refuse a reader with the Settings grant but no read-users, who has no way to them", () => {
    holding([READ_SETTINGS]);
    renderRoute();
    expect(screen.queryByText("the user fields page")).toBeNull();
  });

  it("refuse a reader who may see users but holds no Settings grant", () => {
    holding(["read-users"]);
    renderRoute();
    expect(screen.queryByText("the user fields page")).toBeNull();
  });
});
