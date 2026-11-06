/**
 * Saving an edit to your OWN account that ends your own sessions.
 *
 * The server ends every session an account holds when an administrator sets
 * its password or deactivates it — the editing session included, when the
 * account is the signed-in one. The page signs the user out at once and says
 * why, rather than leaving a tab that fails once its access token expires.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import { useFormContext } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MESSAGES } from "@admin/constants/messages";
import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// Hoisted with the module mocks that read them.
const { state, roles, fields, logout, navigateTo, mutate, meta } = vi.hoisted(
  () => ({
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
    // What the admin metadata delivers to the page's place, set per case.
    meta: { contributions: undefined as AdminContributionsMeta | undefined },
  })
);

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
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
  meta.contributions = undefined;
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

/** The update the page handed the mutation, as the request will carry it. */
function sentUpdates(): Record<string, unknown> {
  // The mutation's first argument: `{ userId, updates }`.
  const variables = mutate.mock.calls[0]?.[0] as {
    updates: Record<string, unknown>;
  };
  return JSON.parse(JSON.stringify(variables.updates)) as Record<
    string,
    unknown
  >;
}

// What the page actually submits: its resolver's parsed values, through its
// own mapping, to the mutation. A space at either end can be a password's
// symbol, and the server hashes the password it receives.
describe("EditUserPage's request", () => {
  it("sends a new password exactly as typed, spaces at its ends included", async () => {
    state.editedId = OTHER;

    await save({ password: " Passw0rd-Edge " });

    expect(sentUpdates().password).toBe(" Passw0rd-Edge ");
  });

  it("sends no password at all when the field is left empty", async () => {
    state.editedId = OTHER;

    await save({});

    expect(sentUpdates()).not.toHaveProperty("password");
  });
});

const BLOCK = "@acme/a/admin#UserBlock";
const TAB = "@acme/a/admin#UserTab";
registerComponent(BLOCK, ((props: { context?: unknown }) => (
  <pre data-testid="user-block">{JSON.stringify(props.context)}</pre>
)) as never);
registerComponent(TAB, () => <p>plugin tab body</p>);

/** The page's own card: the one holding the user's details form. */
function card(container: HTMLElement): Element {
  return container.querySelector("form#edit-user-form")!.closest(".bg-card")!;
}

describe("EditUserPage's place", () => {
  it("with no contributions the page draws as before", () => {
    state.editedId = OTHER;
    const { container } = render(<EditUserPage />);

    // No strip, and the card sits straight after the page's header, as it
    // did before the place: nothing wraps it.
    expect(screen.queryByRole("tablist")).toBeNull();
    const header = screen.getByRole("heading", { name: "Edit User" });
    expect(card(container).previousElementSibling?.contains(header)).toBe(true);
  });

  it("draws a block after the card, told who is looking and at whom", () => {
    state.editedId = OTHER;
    meta.contributions = {
      "user.detail": {
        block: [
          { builtIn: "content" },
          {
            plugin: "@acme/a",
            id: "acme-a.user-block",
            kind: "block",
            component: BLOCK,
          },
        ],
      },
    };
    const { container } = render(<EditUserPage />);

    const block = screen.getByTestId("user-block");
    expect(card(container).nextElementSibling).toBe(block);
    expect(JSON.parse(block.textContent ?? "")).toEqual({
      userId: SIGNED_IN,
      shownUserId: OTHER,
    });
  });

  it("a delivered tab follows the page's own content", () => {
    state.editedId = OTHER;
    meta.contributions = {
      "user.detail": {
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.user-tab",
            kind: "tab",
            label: "Billing",
            component: TAB,
          },
        ],
      },
    };
    const { container } = render(<EditUserPage />);

    const tabs = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map(tab => tab.textContent);
    expect(tabs).toEqual(["Profile", "Billing"]);
    expect(card(container)).toBeTruthy();
  });
});
