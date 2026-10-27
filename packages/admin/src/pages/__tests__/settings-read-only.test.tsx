// @vitest-environment jsdom
/**
 * A settings page is seen on `read-settings` and used on the permission each
 * change asks. A role holding only `read-settings` sees General, Image Sizes
 * and User Fields read-only: no Save, no add, no edit, no delete and no
 * reorder, since the server refuses every one of them. A role holding the
 * change's permission is offered it.
 *
 * The permission hook is replaced by one that checks as the product checks
 * (`holdsPermission`), so `manage-settings` counts as the plain four.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const held = vi.hoisted(() => new Set<string>());

vi.mock("@admin/hooks/useCurrentUserPermissions", async () => {
  const { holdsPermission } = await import(
    "@admin/lib/permissions/holds-permission"
  );
  return {
    useCurrentUserPermissions: () => ({
      hasPermission: (slug: string) => holdsPermission(held, slug),
      isLoading: false,
    }),
  };
});

vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({
    data: { applicationName: "Site", timezone: "UTC" },
    isLoading: false,
  }),
  useUpdateGeneralSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@admin/services/imageSizesApi", () => ({
  fetchImageSizes: () =>
    Promise.resolve([
      {
        id: "size_1",
        name: "Thumbnail",
        width: 320,
        height: 240,
        fit: "cover",
        quality: 80,
        format: "webp",
        isDefault: false,
        sortOrder: 1,
      },
    ]),
  fetchImageProcessingAvailability: () => Promise.resolve({ available: true }),
  deleteImageSize: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useUserFields", () => ({
  useUserFields: () => ({
    data: {
      fields: [
        {
          id: "field_1",
          name: "company",
          label: "Company",
          type: "text",
          required: false,
          source: "ui",
          isActive: true,
          sortOrder: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useDeleteUserField: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderUserFields: () => ({ mutate: vi.fn() }),
}));

import SettingsGeneralPage from "../dashboard/settings/index";
import ImageSizesSettingsPage from "../dashboard/settings/image-sizes/index";
import UserFieldsPage from "../dashboard/users/fields/index";

function holding(...grants: string[]): void {
  held.clear();
  for (const grant of grants) held.add(grant);
}

beforeEach(() => {
  localStorage.clear();
  held.clear();
});

describe("General settings", () => {
  it("offers no Save to a role that may only read settings", () => {
    holding("read-settings");
    render(<SettingsGeneralPage />);
    expect(
      screen.queryByRole("button", { name: "Save Changes" })
    ).not.toBeInTheDocument();
  });

  it("offers Save to a role that may update settings", () => {
    // The control: the same page with the permission the save asks.
    holding("read-settings", "update-settings");
    render(<SettingsGeneralPage />);
    expect(
      screen.getByRole("button", { name: "Save Changes" })
    ).toBeInTheDocument();
  });
});

describe("Image Sizes", () => {
  it("offers nothing to change to a role that may only read settings", async () => {
    holding("read-settings");
    render(<ImageSizesSettingsPage />);
    expect((await screen.findAllByText("Thumbnail")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Add Size")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Row actions" })
    ).not.toBeInTheDocument();
  });

  it("offers adding a size to a role that may create settings, and no row action", async () => {
    holding("read-settings", "create-settings");
    render(<ImageSizesSettingsPage />);
    expect((await screen.findAllByText("Thumbnail")).length).toBeGreaterThan(0);
    expect(screen.getByText("Add Size")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Row actions" })
    ).not.toBeInTheDocument();
  });

  it("offers a size's row actions to a role that may update settings", async () => {
    // The control for the row-action cases above: the selector finds them.
    holding("read-settings", "update-settings");
    render(<ImageSizesSettingsPage />);
    expect((await screen.findAllByText("Thumbnail")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Row actions" }).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Add Size")).not.toBeInTheDocument();
  });
});

describe("User Fields", () => {
  it("offers nothing to change to a role that may only read settings", () => {
    holding("read-settings");
    render(<UserFieldsPage />);
    expect(screen.getAllByText("company").length).toBeGreaterThan(0);
    expect(screen.queryByText("Add Field")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/drag to reorder/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Open menu")).not.toBeInTheDocument();
  });

  it("offers adding, reordering and the field's menu to a role still holding manage-settings", () => {
    // The control: `manage-settings` counts as create, update and delete.
    holding("manage-settings");
    render(<UserFieldsPage />);
    expect(screen.getByText("Add Field")).toBeInTheDocument();
    expect(screen.getByLabelText(/drag to reorder company/i)).toBeInTheDocument();
    expect(screen.getAllByText("Open menu").length).toBeGreaterThan(0);
  });
});
