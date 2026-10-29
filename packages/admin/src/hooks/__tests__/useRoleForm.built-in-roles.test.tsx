/**
 * Saving the built-in roles from the role form.
 *
 * The server refuses any change to a built-in role's details, and lets the
 * Public role's permissions change alone, so a save of Public sends only the
 * permissions call. Super-admin and the presets are never saved from the
 * form: super-admin holds every permission and a preset is changed by copying
 * it, which opens a new role holding the preset's own permissions.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn(async () => ({ items: [] })) },
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/** A stored role as the role API reads it. */
function stored(
  overrides: Partial<{
    roleName: string;
    slug: string;
    type: "System" | "Custom";
    builtIn: "public" | "super-admin";
    permissions: { id: string }[];
  }>
) {
  return {
    role: {
      id: "role-1",
      roleName: "Editor",
      name: "Editor",
      subtitle: "",
      slug: "editor",
      description: "",
      type: "Custom" as const,
      permissions: [] as { id: string }[],
      ...overrides,
    },
    childRoleIds: [],
    childRolePermissionsMap: {},
  };
}

vi.mock("../../services/roleApi", () => ({
  roleApi: {
    getRoleDetails: vi.fn(),
    updateRole: vi.fn(async () => undefined),
    updateRolePermissions: vi.fn(async () => undefined),
    createRole: vi.fn(async () => undefined),
    fetchRoles: vi.fn(async () => ({ items: [] })),
  },
}));

import { navigateTo } from "@admin/lib/navigation";

import { roleApi } from "../../services/roleApi";
import { useRoleCopy } from "../useRoleCopy";
import { useRoleForm } from "../useRoleForm";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The role form, with the copy its screen offers beside it. */
function useRoleScreen(roleId?: string) {
  const roleForm = useRoleForm(roleId);
  return { ...roleForm, copyRole: useRoleCopy(roleId, roleForm.form) };
}

/** The role form for `role`, loaded. */
async function editing(role: ReturnType<typeof stored>) {
  vi.mocked(roleApi.getRoleDetails).mockResolvedValue(role as never);
  const { result } = renderHook(() => useRoleScreen("role-1"), { wrapper });
  await waitFor(() =>
    expect(result.current.form.getValues("name")).toBe(role.role.roleName)
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useRoleForm, for a built-in role", () => {
  it("saves the Public role's permissions alone", async () => {
    const result = await editing(
      stored({
        roleName: "Public",
        slug: "public",
        type: "System",
        builtIn: "public",
      })
    );
    expect(result.current.screenMode).toBe("public");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.updateRole).not.toHaveBeenCalled();
    expect(roleApi.updateRolePermissions).toHaveBeenCalled();
  });

  it("saves nothing of super-admin or of a preset", async () => {
    for (const role of [
      stored({
        roleName: "Super Admin",
        slug: "super-admin",
        type: "System",
        builtIn: "super-admin",
      }),
      stored({ roleName: "Editor", slug: "editor", type: "System" }),
    ]) {
      vi.clearAllMocks();
      const result = await editing(role);

      await act(async () => {
        await result.current.onSubmit();
      });

      expect(roleApi.updateRole).not.toHaveBeenCalled();
      expect(roleApi.updateRolePermissions).not.toHaveBeenCalled();
    }
  });

  it("still saves a role someone made, details first", async () => {
    // POPULATION CONTROL: the ordinary save is untouched.
    const result = await editing(stored({}));
    expect(result.current.screenMode).toBe("editable");

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.updateRole).toHaveBeenCalled();
    expect(roleApi.updateRolePermissions).toHaveBeenCalled();
  });

  it("copies a preset into a new role holding its own permissions", async () => {
    const result = await editing(
      stored({
        roleName: "Editor",
        slug: "editor",
        type: "System",
        permissions: [{ id: "posts-read" }, { id: "posts-update" }],
      })
    );
    expect(result.current.screenMode).toBe("preset");

    act(() => {
      result.current.copyRole();
    });

    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/security/roles/create?copyFrom=role-1"
    );

    // The new role's form, opened at that address, starts from the copy.
    window.history.replaceState(
      {},
      "",
      "/admin/security/roles/create?copyFrom=role-1"
    );
    const { result: created } = renderHook(() => useRoleScreen(), { wrapper });
    await waitFor(() =>
      expect([...created.current.form.getValues("permissions")].sort()).toEqual(
        ["posts-read", "posts-update"]
      )
    );
    expect(created.current.screenMode).toBe("editable");
    expect(created.current.form.getValues("name")).toBe("");
  });
});
