// @vitest-environment jsdom
/**
 * A settings page is seen on `read-settings` and used on the permission each
 * change asks. A role holding only `read-settings` sees General, Image Sizes
 * and User Fields read-only: no Save, no add, no edit, no delete and no
 * reorder, since the server refuses every one of them. It may open a user
 * field or an image size to see it, as the server lets it read one, and the
 * edit page shows it with nothing to save. A role holding the change's
 * permission is offered it.
 *
 * The permission hook is replaced by one that checks as the product checks
 * (`holdsPermission`), so `manage-settings` counts as the plain four.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

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

// One object for every render, as a query's cached data is: a new one each
// time would have the page reset its form on every render.
const generalSettings = vi.hoisted(() => ({
  applicationName: "Site",
  timezone: "UTC",
}));
vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({ data: generalSettings, isLoading: false }),
  useUpdateGeneralSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The id an edit page is opened on, as its route carries it.
const EDITED_ID = "6f1c2b0e-8d4a-4c1e-9a7b-2f3e4d5c6b7a";
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ route: { params: { id: EDITED_ID } } }),
}));

const thumbnail = vi.hoisted(() => ({
  id: "size_1",
  name: "Thumbnail",
  width: 320,
  height: 240,
  fit: "cover",
  quality: 80,
  format: "webp",
  isDefault: false,
  sortOrder: 1,
}));
vi.mock("@admin/services/imageSizesApi", () => ({
  fetchImageSizes: () => Promise.resolve([thumbnail]),
  fetchImageSize: () => Promise.resolve(thumbnail),
  updateImageSize: vi.fn(),
  createImageSize: vi.fn(),
  fetchImageProcessingAvailability: () => Promise.resolve({ available: true }),
  deleteImageSize: vi.fn(),
}));

// One object for every render, for the same reason: the page copies the
// fields into its own state whenever the data changes.
const company = vi.hoisted(() => ({
  id: "field_1",
  name: "company",
  label: "Company",
  type: "text",
  required: false,
  source: "ui",
  isActive: true,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
}));
const userFields = vi.hoisted(() => ({ fields: [company] }));
const oneField = vi.hoisted(() => ({
  data: company,
  isLoading: false,
  error: null,
  refetch: () => undefined,
}));
vi.mock("@admin/hooks/queries/useUserFields", () => ({
  useUserFields: () => ({
    data: userFields,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUserField: () => oneField,
  useUpdateUserField: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateUserField: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteUserField: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderUserFields: () => ({ mutate: vi.fn() }),
}));

import SettingsGeneralPage from "../dashboard/settings/index";
import ImageSizesSettingsPage from "../dashboard/settings/image-sizes/index";
import CreateImageSizePage from "../dashboard/settings/image-sizes/create";
import EditImageSizePage from "../dashboard/settings/image-sizes/edit/[id]";
import CreateUserFieldPage from "../dashboard/users/fields/create";
import EditUserFieldPage from "../dashboard/users/fields/edit/[id]";
import UserFieldsPage from "../dashboard/users/fields/index";

/** Opens the one field's menu, as a pointer press opens it. */
function openFieldMenu(): void {
  const trigger = screen.getByText("Open menu").closest("button");
  if (!trigger) throw new Error("the field's menu has no trigger");
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
}

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
    // The size opens to be seen: its row links to the edit page, which shows
    // it read-only to this role (below).
    expect(
      screen
        .getAllByRole("link", { name: "Thumbnail" })
        .map(link => link.getAttribute("href"))
    ).toContain("/admin/settings/image-sizes/edit/size_1");
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
  it("offers nothing to change to a role that may only read settings", async () => {
    holding("read-settings");
    render(<UserFieldsPage />);
    expect(screen.getAllByText("company").length).toBeGreaterThan(0);
    expect(screen.queryByText("Add Field")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/drag to reorder/i)).not.toBeInTheDocument();
    // The field's menu offers it to see, and nothing to change.
    openFieldMenu();
    expect(await screen.findByRole("menuitem", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("offers adding, reordering and the field's menu to a role still holding manage-settings", async () => {
    // The control: `manage-settings` counts as create, update and delete.
    holding("manage-settings");
    render(<UserFieldsPage />);
    expect(screen.getByText("Add Field")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/drag to reorder company/i)
    ).toBeInTheDocument();
    openFieldMenu();
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "View" })).toBeNull();
  });
});

describe("the edit pages", () => {
  it("shows an image size with nothing to save to a role that may only read settings", async () => {
    holding("read-settings");
    render(<EditImageSizePage />);
    expect(await screen.findByDisplayValue("Thumbnail")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Update Image Size" })
    ).not.toBeInTheDocument();
  });

  it("offers an image size's save to a role that may update settings", async () => {
    // The control: the same page with the permission the save asks.
    holding("read-settings", "update-settings");
    render(<EditImageSizePage />);
    expect(await screen.findByDisplayValue("Thumbnail")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Update Image Size" })
    ).toBeInTheDocument();
  });

  it("shows a user field with nothing to save to a role that may only read settings", () => {
    holding("read-settings");
    render(<EditUserFieldPage />);
    expect(screen.getByDisplayValue("Company")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Update Field" })
    ).not.toBeInTheDocument();
  });

  it("offers a user field's save to a role that may update settings", () => {
    holding("read-settings", "update-settings");
    render(<EditUserFieldPage />);
    expect(screen.getByDisplayValue("Company")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Update Field" })
    ).toBeInTheDocument();
  });
});

describe("the create pages", () => {
  // The route asks create; each page also asks read, which the list it is
  // reached from and returns to after a create asks.
  const PAGES = [
    ["an image size", CreateImageSizePage, "Create Image Size"],
    ["a user field", CreateUserFieldPage, "Create Field"],
  ] as const;

  for (const [what, Page, save] of PAGES) {
    it(`refuses ${what}'s form to a role that may create settings but not read them`, () => {
      holding("create-settings");
      render(<Page />);
      expect(
        screen.getByText("You don't have access to this page")
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: save })
      ).not.toBeInTheDocument();
    });

    it(`offers ${what}'s form to a role that may read and create settings`, () => {
      // The control: the same page with read as well.
      holding("read-settings", "create-settings");
      render(<Page />);
      expect(screen.getByRole("button", { name: save })).toBeInTheDocument();
    });
  }
});
