/**
 * The role form holds and saves only the permissions a role holds itself.
 *
 * A base role's permissions are shown locked beside the role's own, but they
 * are the base's: the permissions save replaces the role's own assignments,
 * so one sent as the role's own would be copied onto it and outlast its
 * removal from the base. The form's value is therefore the role's own
 * permissions alone, and the locked ones are kept apart.
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
    fetchRoles: vi.fn(async () => ({ items: [] })),
    getRoleDetails: vi.fn(),
    getRoleById: vi.fn(),
    updateRole: vi.fn(async () => undefined),
    updateRolePermissions: vi.fn(async () => undefined),
    createRole: vi.fn(async () => ({ id: "role-new" })),
  },
}));

import { roleApi } from "../../services/roleApi";
import { useRoleForm } from "../useRoleForm";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** The form for a role holding `own` itself, built on a base giving `inherited`. */
async function editingRole(own: string[], inherited: string[]) {
  vi.mocked(roleApi.getRoleDetails).mockResolvedValue({
    role: {
      id: "role-1",
      roleName: "Editor",
      name: "Editor",
      subtitle: "",
      slug: "editor",
      description: "",
      type: "Custom",
      permissions: own,
    },
    childRoleIds: ["base-1"],
    childRolePermissionsMap: { "base-1": inherited },
  });
  const { result } = renderHook(() => useRoleForm("role-1"), {
    wrapper: wrapper(),
  });
  // Loaded once the base's permissions are locked.
  await waitFor(() =>
    expect(result.current.lockedPermissionIds).toEqual(inherited)
  );
  return result;
}

/** The form for a new role built on one base giving `inherited`. */
function creatingOnBase(inherited: string[]) {
  const { result } = renderHook(() => useRoleForm(), { wrapper: wrapper() });
  act(() => {
    result.current.form.setValue("name", "Writer");
    result.current.form.setValue("slug", "writer");
    // As choosing a base leaves the form: the base chosen and its
    // permissions locked.
    result.current.setSelectedBaseRoleIds(["base-1"]);
    result.current.setLockedPermissionIds(inherited);
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the role form on a role built on a base role", () => {
  it("holds only the role's own permissions, not the base's", async () => {
    const result = await editingRole(["p1"], ["p3"]);

    expect(result.current.form.getValues("permissions")).toEqual(["p1"]);
  });

  it("saves only the role's own permissions", async () => {
    const result = await editingRole(["p1"], ["p3"]);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.updateRolePermissions).toHaveBeenCalledWith(
      "role-1",
      ["p1"],
      ["p1"]
    );
  });

  it("keeps a permission the role holds itself as well as inheriting it", async () => {
    const result = await editingRole(["p1", "p3"], ["p3"]);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.updateRolePermissions).toHaveBeenCalledWith(
      "role-1",
      ["p1", "p3"],
      ["p1", "p3"]
    );
  });

  it("takes away a permission the role holds itself though it also inherits it", async () => {
    const result = await editingRole(["p1", "p3"], ["p3"]);

    // What Clear All hands the form.
    act(() => {
      result.current.form.setValue("permissions", []);
    });
    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.updateRolePermissions).toHaveBeenCalledWith(
      "role-1",
      ["p1", "p3"],
      []
    );
  });

  it("creates a role with only the permissions it was given itself", async () => {
    const result = creatingOnBase(["p3"]);
    act(() => {
      result.current.form.setValue("permissions", ["p1"]);
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.createRole).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ["p1"], childRoleIds: ["base-1"] })
    );
  });

  it("says a role on one base needs a permission of its own, and sends nothing", async () => {
    const result = creatingOnBase(["p3"]);

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(result.current.error).toBe(
      "A role built on one base needs at least one permission of its own."
    );
    expect(roleApi.createRole).not.toHaveBeenCalled();
  });
});
