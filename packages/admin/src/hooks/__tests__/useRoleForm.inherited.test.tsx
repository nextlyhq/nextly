/**
 * Saving a role sends only the permissions it holds itself.
 *
 * The form shows a base role's permissions ticked and locked, so its value
 * holds them alongside the role's own. The permissions save replaces the
 * role's own assignments, so sending the value whole would copy every
 * inherited permission onto the role, where it would outlast its removal
 * from the base.
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
  // Loaded once the base's permissions are locked and shown in the value.
  await waitFor(() =>
    expect(result.current.lockedPermissionIds).toEqual(inherited)
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saving a role built on a base role", () => {
  it("does not send the base's permissions as the role's own", async () => {
    const result = await editingRole(["p1"], ["p3"]);
    // POPULATION CONTROL: the form shows the inherited permission ticked.
    expect(result.current.form.getValues("permissions")).toEqual(["p1", "p3"]);

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

  it("creates a role with only the permissions it was given itself", async () => {
    const { result } = renderHook(() => useRoleForm(), { wrapper: wrapper() });
    act(() => {
      result.current.form.setValue("name", "Writer");
      result.current.form.setValue("slug", "writer");
      // As choosing a base role leaves the form: its permissions locked and
      // ticked beside the one chosen here.
      result.current.setLockedPermissionIds(["p3"]);
      result.current.form.setValue("permissions", ["p1", "p3"]);
    });

    await act(async () => {
      await result.current.onSubmit();
    });

    expect(roleApi.createRole).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ["p1"] })
    );
  });
});
