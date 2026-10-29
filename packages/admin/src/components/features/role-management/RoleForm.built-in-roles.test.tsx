/**
 * The role form for the built-in roles.
 *
 * Super-admin holds every permission, so it shows a line saying so and no
 * permissions or save. The Public role shows what visitors who aren't signed
 * in may do, with its permissions in visitor mode, and saves. A preset shows
 * its permissions read-only, with a way to copy it into a role that can be
 * changed, and no save. Any other role is the ordinary form.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  screenMode: "editable" as "super-admin" | "public" | "preset" | "editable",
  copyRole: vi.fn(),
  section: undefined as Record<string, unknown> | undefined,
  inheritance: false,
}));

vi.mock("@admin/hooks/useRoleForm", async () => {
  const { useForm } =
    await vi.importActual<typeof import("react-hook-form")>("react-hook-form");
  return {
    useRoleForm: () => {
      const form = useForm({ defaultValues: { name: "", permissions: [] } });
      return {
        form,
        role: { name: "A role" },
        levelRows: [],
        pluginGroups: [],
        otherPermissions: [],
        baseGrants: [],
        allRoles: [],
        isLoading: false,
        error: null,
        isEditMode: true,
        isSystemRole: state.screenMode !== "editable",
        screenMode: state.screenMode,
        copyRole: state.copyRole,
        selectedBaseRoleIds: [],
        setSelectedBaseRoleIds: vi.fn(),
        lockedPermissionIds: [],
        setLockedPermissionIds: vi.fn(),
        setRolePermissionsMap: vi.fn(),
        onSubmit: vi.fn(),
        handleNameChange: vi.fn(),
        handleCancel: vi.fn(),
        formRef: { current: null },
      };
    },
  };
});

vi.mock("./RoleBasicInfo", () => ({ RoleBasicInfo: () => null }));
vi.mock("./RoleInheritance", () => ({
  RoleInheritance: () => {
    state.inheritance = true;
    return null;
  },
}));
vi.mock("./RolePermissionsSection", () => ({
  RolePermissionsSection: (props: Record<string, unknown>) => {
    state.section = props;
    return null;
  },
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));
vi.mock("@admin/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));

import { RoleForm } from "./RoleForm";

const SUPER_ADMIN_LINE =
  "Super-admins have every permission, including new collections and plugins. This role can't be edited.";
const PUBLIC_LINE = "This is what visitors who aren't signed in can see.";

beforeEach(() => {
  state.section = undefined;
  state.inheritance = false;
  state.copyRole.mockClear();
});

describe("the role form for a built-in role", () => {
  it("shows super-admin's line, and no permissions or save", () => {
    state.screenMode = "super-admin";
    render(<RoleForm roleId="r1" />);

    expect(screen.getByText(SUPER_ADMIN_LINE)).toBeInTheDocument();
    expect(state.section).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: /update role/i })
    ).not.toBeInTheDocument();
  });

  it("shows the Public role's line, its permissions for visitors, and a save", () => {
    state.screenMode = "public";
    render(<RoleForm roleId="r1" />);

    expect(screen.getByText(PUBLIC_LINE)).toBeInTheDocument();
    expect(state.section).toMatchObject({ visitors: true, readOnly: false });
    // The Public role is never built on another.
    expect(state.inheritance).toBe(false);
    expect(
      screen.getByRole("button", { name: /update role/i })
    ).toBeInTheDocument();
  });

  it("shows a preset read-only, with a copy to change and no save", async () => {
    state.screenMode = "preset";
    render(<RoleForm roleId="r1" />);

    expect(state.section).toMatchObject({ readOnly: true });
    expect(
      screen.queryByRole("button", { name: /update role/i })
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to change" })
    );
    expect(state.copyRole).toHaveBeenCalledTimes(1);
  });

  it("leaves the ordinary form as it is", () => {
    // POPULATION CONTROL: no line, editable permissions, a save.
    state.screenMode = "editable";
    render(<RoleForm roleId="r1" />);

    expect(screen.queryByText(SUPER_ADMIN_LINE)).not.toBeInTheDocument();
    expect(screen.queryByText(PUBLIC_LINE)).not.toBeInTheDocument();
    expect(state.section).toMatchObject({ readOnly: false });
    expect(state.section?.visitors).toBeFalsy();
    expect(state.inheritance).toBe(true);
    expect(
      screen.getByRole("button", { name: /update role/i })
    ).toBeInTheDocument();
  });
});
