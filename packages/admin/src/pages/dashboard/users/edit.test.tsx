/**
 * Saving an edit to your OWN account that ends your own sessions.
 *
 * The server ends every session an account holds when an administrator sets
 * its password or deactivates it — the editing session included, when the
 * account is the signed-in one. The page signs the user out at once and says
 * why, rather than leaving a tab that fails once its access token expires.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFormContext } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MESSAGES } from "@admin/constants/messages";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// Hoisted with the module mocks that read them.
const { state, roles, fields, logout, navigateTo, mutate } = vi.hoisted(() => ({
  state: {
    editedId: "11111111-1111-4111-8111-111111111111",
    users: {} as Record<string, Record<string, unknown>>,
  },
  // Stable across renders, as a query cache returns them: a fresh object on
  // every render re-runs the page's form reset on every render.
  roles: { items: [] },
  fields: { fields: [] },
  logout: vi.fn(),
  navigateTo: vi.fn(),
  mutate: vi.fn((_vars: unknown, opts: { onSuccess: () => void }) =>
    opts.onSuccess()
  ),
}));

vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ route: { params: { id: state.editedId } } }),
}));
vi.mock("@admin/hooks/queries/useUsers", () => ({
  useUser: () => ({
    data: (state.users[state.editedId] ??= {
      id: state.editedId,
      name: "Admin",
      email: "admin@example.com",
      isActive: true,
      roles: ["role-admin"],
    }),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateUser: () => ({ mutate, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useRoles", () => ({
  useRoles: () => ({
    data: roles,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/queries/useUserFields", () => ({
  useUserFields: () => ({ data: fields }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: SIGNED_IN } }),
}));
vi.mock("@admin/hooks/useLogout", () => ({ useLogout: () => logout }));
vi.mock("@admin/lib/navigation", () => ({ navigateTo }));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// The fields the cases change, registered on the page's own form.
vi.mock("@admin/components/features/user-management/form-fields", () => ({
  UserFormFields: () => {
    const { register } = useFormContext();
    return (
      <>
        <input aria-label="password" {...register("password")} />
        <input type="checkbox" aria-label="active" {...register("active")} />
      </>
    );
  },
}));
vi.mock("@admin/components/features/user-management/avatar-uploader", () => ({
  AvatarUploader: () => null,
}));
vi.mock("@admin/components/features/user-management/breadcrumbs", () => ({
  UserBreadcrumbs: () => null,
}));
vi.mock("@admin/components/features/users/UserCustomFields", () => ({
  UserCustomFields: () => null,
}));

import EditUserPage from "./edit";

beforeEach(() => {
  state.editedId = SIGNED_IN;
  logout.mockClear();
  navigateTo.mockClear();
  mutate.mockClear();
});

async function save(change: { password?: string; deactivate?: boolean }) {
  const { container } = render(<EditUserPage />);
  if (change.password) {
    fireEvent.change(screen.getByLabelText("password"), {
      target: { value: change.password },
    });
  }
  if (change.deactivate) fireEvent.click(screen.getByLabelText("active"));
  fireEvent.submit(container.querySelector("form#edit-user-form")!);
  await waitFor(() => expect(mutate).toHaveBeenCalled());
}

describe("EditUserPage on your own account", () => {
  it("signs you out with the reason after you set your own password", async () => {
    await save({ password: "N3wStr0ngP@ss!" });

    expect(logout).toHaveBeenCalledWith({
      message: USER_MESSAGES.OWN_PASSWORD_CHANGED,
    });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("signs you out with the reason after you deactivate yourself", async () => {
    await save({ deactivate: true });

    expect(logout).toHaveBeenCalledWith({
      message: USER_MESSAGES.OWN_ACCOUNT_DEACTIVATED,
    });
  });

  it("keeps you signed in after an edit that ends no session", async () => {
    // The control: a page that signed out on every save would pass both cases
    // above.
    await save({});

    expect(logout).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalled();
  });

  it("keeps you signed in after you set ANOTHER user's password", async () => {
    state.editedId = OTHER;

    await save({ password: "N3wStr0ngP@ss!" });

    expect(logout).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalled();
  });
});
