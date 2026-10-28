/**
 * Settings are granted by plain permissions: a page is seen on `read-settings`
 * and used on the permission its action names. A role holding read and update
 * on settings, and no `manage-` permission, sees the settings pages and edits
 * on them, and is not offered creating what it may not create. A role still
 * holding only `manage-settings`, not yet converted by `nextly upgrade`, is
 * shown none of them, as the server refuses it every one.
 *
 * Asked through the real permission hook, answered by a mocked
 * `/me/permissions`, so the check under test is the one the guards and the
 * sidebar call.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { UserPermissionsResponse } from "../../types/permissions";

const server = vi.hoisted(() => ({
  permissions: undefined as UserPermissionsResponse | undefined,
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async (path: string) => {
      if (path === "/me/permissions") return server.permissions;
      if (path.split("?")[0] === "/me/capabilities") {
        return { isSuperAdmin: false, entities: {} };
      }
      throw new Error(`unexpected request ${path}`);
    },
  },
}));

vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ route: { routeType: "private" } }),
}));

vi.mock("@admin/hooks/useLocaleParam", () => ({
  useLocaleParam: () => undefined,
}));

import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import { visibleSettingsNav } from "../../components/layout/sidebar/lib/settings-nav";
import { settingsPermissionAt } from "../dashboard/plugins/[slug]/settings";
import { routeConfig } from "../registry";

/** The signed-in user's access, as the real hook answers it for `held`. */
async function accessFor(held: string[]) {
  server.permissions = {
    permissions: held,
    isSuperAdmin: false,
    roles: ["under-test"],
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCurrentUserPermissions(), {
    wrapper,
  });
  await waitFor(() => expect(result.current.permissions).toEqual(held));
  return result.current;
}

/** Whether a route's guard admits `access`, as `PermissionGuard` asks it. */
function guardAdmits(
  route: string,
  access: { hasPermission: (slug: string) => boolean }
): boolean {
  const required = routeConfig[route]?.requiredPermission;
  if (required === undefined) throw new Error(`${route} has no guard`);
  return Array.isArray(required)
    ? required.some(access.hasPermission)
    : access.hasPermission(required);
}

/** The settings pages a reader sees, and the editing one an editor uses. */
const SEEN = [
  ROUTES.SETTINGS,
  ROUTES.SETTINGS_IMAGE_SIZES,
  ROUTES.USERS_FIELDS,
];
const EDITED = [ROUTES.SETTINGS_IMAGE_SIZES_EDIT, ROUTES.USERS_FIELDS_EDIT];
const CREATED = [
  ROUTES.SETTINGS_IMAGE_SIZES_CREATE,
  ROUTES.USERS_FIELDS_CREATE,
];
/** The settings nav entries a settings reader is shown. */
const NAV = ["general", "image-sizes", "user-fields"];

/** The settings nav entries shown, the API-key and webhook entries aside. */
const navIds = (access: { hasPermission: (slug: string) => boolean }) =>
  visibleSettingsNav({
    hasPermission: access.hasPermission,
    canAccessApiKeys: false,
    canAccessWebhooks: false,
  }).flatMap(group => group.items.map(item => item.id));

describe("the settings pages, by plain permission", () => {
  it("shows a role holding read and update on settings every settings page, and lets it edit", async () => {
    const access = await accessFor(["read-settings", "update-settings"]);

    expect(access.capabilities.canViewSettings).toBe(true);
    for (const route of [...SEEN, ...EDITED]) {
      expect(guardAdmits(route, access), route).toBe(true);
    }
    expect(navIds(access)).toEqual(expect.arrayContaining(NAV));
    // A plugin that names no permission of its own takes a settings change.
    expect(access.hasPermission(settingsPermissionAt([], "seo"))).toBe(true);
    // Creating asks create, which this role does not hold.
    for (const route of CREATED) {
      expect(guardAdmits(route, access), route).toBe(false);
    }
  });

  it("opens the edit pages to a role that may read settings, and not to one that may only update them", async () => {
    // An edit page first loads what it shows, a read that asks
    // `read-settings`: a reader opens it read-only, and a role holding only
    // `update-settings` would be shown a form that cannot load.
    const reader = await accessFor(["read-settings"]);
    for (const route of EDITED) {
      expect(guardAdmits(route, reader), route).toBe(true);
    }
    const updater = await accessFor(["update-settings"]);
    for (const route of EDITED) {
      expect(guardAdmits(route, updater), route).toBe(false);
    }
  });

  it("shows a role still holding only manage-settings none of them, as the server refuses them", async () => {
    const access = await accessFor(["manage-settings"]);

    expect(access.capabilities.canViewSettings).toBe(false);
    for (const route of [...SEEN, ...EDITED, ...CREATED]) {
      expect(guardAdmits(route, access), route).toBe(false);
    }
    expect(navIds(access)).not.toEqual(expect.arrayContaining(["general"]));
    expect(access.hasPermission(settingsPermissionAt([], "seo"))).toBe(false);
  });

  it("shows a role holding no settings permission none of them", async () => {
    const access = await accessFor(["read-media"]);

    expect(access.capabilities.canViewSettings).toBe(false);
    for (const route of [...SEEN, ...EDITED, ...CREATED]) {
      expect(guardAdmits(route, access), route).toBe(false);
    }
    expect(navIds(access)).not.toEqual(expect.arrayContaining(["general"]));
  });
});
