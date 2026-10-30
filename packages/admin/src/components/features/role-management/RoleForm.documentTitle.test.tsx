/**
 * The role editor names the role it edits in the browser tab.
 *
 * `useRoleForm` is replaced by one that hands back a real form and a role the
 * test controls, so the two names a role has on this screen can move apart:
 * the role as loaded (and as last saved), and the name field being typed in.
 * The tab follows the first. A title that tracked the field would rename the
 * tab with every keystroke of an edit that may never be saved.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: null as { name: string } | null,
  setName: undefined as ((name: string) => void) | undefined,
}));

vi.mock("@admin/hooks/useRoleForm", async () => {
  const { useForm } =
    await vi.importActual<typeof import("react-hook-form")>("react-hook-form");
  return {
    useRoleForm: () => {
      const form = useForm({
        defaultValues: { name: state.role?.name ?? "", permissions: [] },
      });
      state.setName = name =>
        form.setValue("name", name, { shouldDirty: true });
      return {
        form,
        role: state.role,
        allPermissions: [],
        levelRows: [],
        pluginGroups: [],
        otherPermissions: [],
        baseGrants: [],
        allRoles: [],
        isLoading: false,
        error: null,
        isEditMode: true,
        isSystemRole: false,
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

// The form's sections draw controls this test never reads.
vi.mock("./RoleBasicInfo", () => ({ RoleBasicInfo: () => null }));
vi.mock("./RoleInheritance", () => ({ RoleInheritance: () => null }));
vi.mock("./RolePermissionsSection", () => ({
  RolePermissionsSection: () => null,
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useAppName: () => "Golden Shop",
  useBranding: () => ({}),
}));

import { createTestQueryClient } from "@admin/__tests__/utils";
import { DocumentTitleProvider } from "@admin/context/providers/DocumentTitleProvider";
import { resolveRoute } from "@admin/lib/routing";

import { RoleForm } from "./RoleForm";

const EDIT_PATH = "/admin/security/roles/edit/r1";
const client = createTestQueryClient();

function editor() {
  return (
    <QueryClientProvider client={client}>
      <DocumentTitleProvider
        route={resolveRoute(EDIT_PATH, "")}
        pathname={EDIT_PATH}
      >
        <RoleForm roleId="r1" />
      </DocumentTitleProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  document.title = "Host title";
  state.role = null;
});

describe("the role editor's tab title", () => {
  it("names the role once it has loaded, and its saved name after that", () => {
    const view = render(editor());
    expect(document.title).toBe("Roles · Golden Shop");

    state.role = { name: "Editor" };
    view.rerender(editor());
    expect(document.title).toBe("Editor · Roles · Golden Shop");

    state.role = { name: "Chief Editor" };
    view.rerender(editor());
    expect(document.title).toBe("Chief Editor · Roles · Golden Shop");
  });

  it("does not follow the name field while it is being edited", () => {
    state.role = { name: "Editor" };
    const view = render(editor());
    expect(document.title).toBe("Editor · Roles · Golden Shop");

    act(() => state.setName?.("Chief Ed"));
    view.rerender(editor());

    expect(document.title).toBe("Editor · Roles · Golden Shop");
  });
});
