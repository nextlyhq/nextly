/**
 * Saving a role from the role form asks again what the signed-in user may do.
 *
 * The form saves through `roleApi` directly rather than through the role
 * mutations, so it owes the refresh those mutations make: the signed-in user
 * may hold the role being edited, and the admin's answer about what they may
 * do is otherwise kept until a focus refresh.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: vi.fn(async () => ({ items: [] })) },
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../services/roleApi", () => ({
  roleApi: {
    getRoleDetails: vi.fn(async () => ({
      role: {
        id: "role-1",
        roleName: "Editor",
        description: "",
        type: "Custom",
        permissions: [],
      },
      childRoleIds: [],
      childRolePermissionsMap: {},
    })),
    updateRole: vi.fn(async () => undefined),
    updateRolePermissions: vi.fn(async () => undefined),
    createRole: vi.fn(async () => undefined),
  },
}));

import { roleApi } from "../../services/roleApi";
import {
  CURRENT_USER_CAPABILITIES_KEY,
  CURRENT_USER_PERMISSIONS_KEY,
} from "../current-user-access";
import { useRoleForm } from "../useRoleForm";

/** The role form for an edited role, loaded, and the cache it refreshes. */
async function editingRole() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useRoleForm("role-1"), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() =>
    expect(result.current.form.getValues("name")).toBe("Editor")
  );
  return { result, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useRoleForm", () => {
  it("asks again what the user may do after saving an edited role", async () => {
    const { result, invalidate } = await editingRole();

    await act(async () => {
      await result.current.onSubmit();
    });

    // The save was made: the refresh below follows a real edit.
    expect(roleApi.updateRole).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_USER_CAPABILITIES_KEY,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_USER_PERMISSIONS_KEY,
    });
  });

  it("asks again once the role is saved, though its permissions then fail", async () => {
    // The role's own save can change what it inherits, so it is a change to
    // what its holders may do whatever happens to the request after it.
    vi.mocked(roleApi.updateRolePermissions).mockRejectedValueOnce(
      new Error("permissions save failed")
    );
    const { result, invalidate } = await editingRole();

    await act(async () => {
      await result.current.onSubmit();
    });

    // POPULATION CONTROL: the failure did happen, after the role was saved.
    expect(roleApi.updateRole).toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_USER_CAPABILITIES_KEY,
    });
  });
});
