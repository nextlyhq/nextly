/**
 * A new role opened as a copy of another holds while the copied role loads:
 * an edit or a save made before it arrives would be overwritten by it, or
 * would create the role without the permissions it was copied for.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/components/ui", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../services/roleApi", () => ({
  roleApi: { getRoleDetails: vi.fn() },
}));

import type { RoleFormValuesType } from "../useRoleForm";
import { roleApi } from "../../services/roleApi";
import { useRoleCopy } from "../useRoleCopy";

function useCopying() {
  const form = useForm<RoleFormValuesType>({
    defaultValues: {
      name: "",
      description: "",
      permissions: [],
    } as unknown as RoleFormValuesType,
  });
  return { form, copy: useRoleCopy(undefined, form) };
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useRoleCopy", () => {
  it("holds the new role's form until the role it copies has loaded", async () => {
    let arrive: (value: unknown) => void = () => undefined;
    vi.mocked(roleApi.getRoleDetails).mockReturnValue(
      new Promise(resolve => {
        arrive = resolve;
      }) as never
    );
    window.history.replaceState(
      {},
      "",
      "/admin/security/roles/create?copyFrom=role-1"
    );
    const { result } = renderHook(() => useCopying());

    expect(result.current.copy.copying).toBe(true);

    await act(async () => {
      arrive({
        role: { description: "Copied", permissions: [{ id: "posts-read" }] },
      });
    });
    await waitFor(() => expect(result.current.copy.copying).toBe(false));
    expect(result.current.form.getValues("description")).toBe("Copied");
  });

  it("holds nothing where the form is not a copy", () => {
    // CONTROL: a plain new role.
    const { result } = renderHook(() => useCopying());
    expect(result.current.copy.copying).toBe(false);
  });

  it("holds nothing for a copy that names no role", () => {
    // An address with an empty `copyFrom` names nothing to load, so the form
    // is not held waiting for it.
    window.history.replaceState(
      {},
      "",
      "/admin/security/roles/create?copyFrom="
    );
    const { result } = renderHook(() => useCopying());
    expect(result.current.copy.copying).toBe(false);
  });
});
