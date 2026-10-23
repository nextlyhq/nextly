/**
 * The role, permission and user edits ask again what the signed-in user may
 * do once the edit has landed, and only then.
 *
 * An answer the admin invalidates stops counting until a newer one arrives,
 * so invalidating after an edit that failed would cost the user their access
 * answer for nothing, and take the pages it decides offline if the refresh
 * then failed too.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/services/userApi", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  fetchUsers: vi.fn(),
  getUserById: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@admin/services/roleApi", () => ({
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  fetchRoles: vi.fn(),
  getRoleById: vi.fn(),
  updateRole: vi.fn(),
}));
vi.mock("@admin/services/permissionApi", () => ({
  deletePermission: vi.fn(),
  fetchPermissions: vi.fn(),
  getPermissionById: vi.fn(),
  updatePermission: vi.fn(),
}));

import { updatePermission } from "@admin/services/permissionApi";
import { updateRole } from "@admin/services/roleApi";
import { updateUser } from "@admin/services/userApi";
import type { Permission } from "@admin/types/entities";

import { CURRENT_USER_CAPABILITIES_KEY } from "../../current-user-access";
import { useUpdatePermission } from "../usePermissions";
import { useUpdateRole } from "../useRoles";
import { useUpdateUser } from "../useUsers";

const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

/** One edit: how its service answers, and how the admin makes it. */
interface Edit {
  name: string;
  lands: () => void;
  fails: () => void;
  /** The admin's hook for the edit, handing back a way to make it. */
  use: () => () => Promise<unknown>;
}

const EDITS: Edit[] = [
  {
    name: "a user edit",
    lands: () => vi.mocked(updateUser).mockResolvedValueOnce(undefined),
    fails: () =>
      vi.mocked(updateUser).mockRejectedValueOnce(new Error("refused")),
    use: () => {
      const edit = useUpdateUser();
      return () => edit.mutateAsync({ userId: "user-1", updates: {} });
    },
  },
  {
    name: "a role edit",
    lands: () => vi.mocked(updateRole).mockResolvedValueOnce(undefined),
    fails: () =>
      vi.mocked(updateRole).mockRejectedValueOnce(new Error("refused")),
    use: () => {
      const edit = useUpdateRole();
      return () => edit.mutateAsync({ roleId: "role-1", updates: {} });
    },
  },
  {
    name: "a permission edit",
    lands: () =>
      vi
        .mocked(updatePermission)
        .mockResolvedValueOnce({ id: "permission-1" } as Permission),
    fails: () =>
      vi.mocked(updatePermission).mockRejectedValueOnce(new Error("refused")),
    use: () => {
      const edit = useUpdatePermission();
      return () =>
        edit.mutateAsync({ permissionId: "permission-1", updates: {} });
    },
  },
];

/** Make the edit, settled either way, and report what it invalidated. */
async function invalidatedBy(edit: Edit): Promise<unknown[][]> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(edit.use, { wrapper: wrapperFor(client) });
  await act(async () => {
    await result.current().catch(() => undefined);
  });
  return invalidate.mock.calls.map(([filters]) => [filters?.queryKey]);
}

const asksAccessAgain = (keys: unknown[][]): boolean =>
  keys.some(
    ([key]) =>
      JSON.stringify(key) === JSON.stringify(CURRENT_USER_CAPABILITIES_KEY)
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(EDITS)("$name", edit => {
  it("asks again what the user may do once it lands", async () => {
    edit.lands();
    expect(asksAccessAgain(await invalidatedBy(edit))).toBe(true);
  });

  it("asks nothing again when it fails", async () => {
    edit.fails();
    const keys = await invalidatedBy(edit);
    // POPULATION CONTROL: the edit's own caches are still reconciled.
    expect(keys.length).toBeGreaterThan(0);
    expect(asksAccessAgain(keys)).toBe(false);
  });
});
