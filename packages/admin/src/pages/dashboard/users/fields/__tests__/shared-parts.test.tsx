/**
 * User custom fields are added through the shared field picker and edited in
 * the shared settings panel, configured for user fields, and keep their own
 * save: the editor hands the page form values, checked by the user-field
 * schema, as it did before.
 *
 * What each test separates from a plausible broken editor:
 * - a field added and edited reaches the save with the panel's settings in
 *   the user field's own spelling, not only on screen;
 * - a saved field's name and type, and a dropdown's "several choices", are
 *   fixed with the reason, and a new field's are not;
 * - only the bounds a user field stores are offered;
 * - a reserved name is refused before anything is sent.
 *
 * Reordering stays the list's own drag and drop, which the browser test of
 * this page covers: jsdom has no layout for dnd-kit's keyboard sorting.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import {
  UserFieldForm,
  type UserFieldFormValues,
} from "@admin/components/features/settings/UserFieldForm";
import type { UserFieldDefinitionRecord } from "@admin/services/userFieldsApi";

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({}),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    retry: () => {},
    isBrandingUnavailable: false,
  }),
}));

const TEAM: UserFieldDefinitionRecord = {
  id: "f1",
  name: "team",
  label: "Team",
  type: "select",
  required: false,
  defaultValue: null,
  options: [
    { label: "Sales", value: "sales" },
    { label: "Support", value: "support" },
  ],
  hasMany: false,
  minLength: null,
  maxLength: null,
  minValue: null,
  maxValue: null,
  placeholder: null,
  description: "Where they work",
  sortOrder: 1,
  source: "ui",
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type User = ReturnType<typeof userEvent.setup>;

/** Chooses a type in the picker by search, with a label. */
async function choose(user: User, search: string, label: string) {
  const picker = screen.getByRole("dialog");
  await user.type(
    within(picker).getByRole("combobox", { name: "Search field types" }),
    `${search}{Enter}`
  );
  await user.type(
    within(picker).getByRole("textbox", { name: "Label" }),
    label
  );
  await user.click(within(picker).getByRole("button", { name: "Add field" }));
}

function createForm() {
  const onSubmit = vi.fn<(values: UserFieldFormValues) => void>();
  render(<UserFieldForm mode="create" isPending={false} onSubmit={onSubmit} />);
  return { user: userEvent.setup(), onSubmit };
}

describe("user custom fields on the shared picker and panel", () => {
  it("adds and edits a user field through the shared parts", async () => {
    const { user, onSubmit } = createForm();
    await user.click(
      screen.getByRole("button", { name: "Choose a field type" })
    );
    await choose(user, "phone", "Mobile number");

    // The panel opens on the new field, its name taken from the label.
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "mobile_number"
    );
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "For delivery calls"
    );
    await user.click(screen.getByRole("switch", { name: "Required" }));
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    await user.type(screen.getByLabelText("Max length"), "20");

    await user.click(screen.getByRole("button", { name: "Create Field" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "phone",
        name: "mobile_number",
        label: "Mobile number",
        description: "For delivery calls",
        required: true,
        maxLength: "20",
        isActive: true,
      })
    );
  });

  it("an existing user field's name and type are fixed, with the reason", async () => {
    render(
      <UserFieldForm
        mode="edit"
        userField={TEAM}
        isPending={false}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(
      screen.getAllByText(/cannot change once the field exists/).length
    ).toBeGreaterThan(0);
    // A dropdown's "several choices" decides how values are stored, so it is
    // fixed too.
    expect(
      screen.getByRole("switch", { name: "Allow several choices" })
    ).toBeDisabled();
    // No way to choose another type.
    expect(screen.queryByRole("button", { name: "Change type…" })).toBeNull();
  });

  it("offers Change type… before the field exists, keeping its label", async () => {
    const { user, onSubmit } = createForm();
    await user.click(
      screen.getByRole("button", { name: "Choose a field type" })
    );
    await choose(user, "text", "Nickname");
    expect(
      screen.queryByText(/cannot change once the field exists/)
    ).toBeNull();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Change type…" }));
    await choose(user, "textarea", "Nickname");
    await user.click(screen.getByRole("button", { name: "Create Field" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "textarea", name: "nickname" })
    );
  });

  it("offers only the bounds a user field stores", async () => {
    const { user } = createForm();
    await user.click(
      screen.getByRole("button", { name: "Choose a field type" })
    );
    await choose(user, "number", "Age");
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    expect(screen.getByLabelText("Min", { exact: true })).toBeInTheDocument();
    // Core allows a pattern and a message; a user field keeps neither.
    expect(screen.queryByLabelText("Pattern")).toBeNull();
    expect(screen.queryByLabelText("Custom error message")).toBeNull();
  });

  it("refuses a reserved name before anything is sent", async () => {
    const { user, onSubmit } = createForm();
    await user.click(
      screen.getByRole("button", { name: "Choose a field type" })
    );
    await choose(user, "text", "Email");
    await user.click(screen.getByRole("button", { name: "Create Field" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText("The field cannot be saved yet")
    ).toBeInTheDocument();
  });

  it("keeps a URL field's default, typed as text", async () => {
    const { user, onSubmit } = createForm();
    await user.click(
      screen.getByRole("button", { name: "Choose a field type" })
    );
    await choose(user, "url", "Website");
    await user.type(
      screen.getByRole("textbox", { name: "Default value" }),
      "https://example.com"
    );
    await user.click(screen.getByRole("button", { name: "Create Field" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "url",
        defaultValue: "https://example.com",
      })
    );
  });

  it("keeps whether the field is active", async () => {
    const onSubmit = vi.fn();
    render(
      <UserFieldForm
        mode="edit"
        userField={TEAM}
        isPending={false}
        onSubmit={onSubmit}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: "Active" }));
    await user.click(screen.getByRole("button", { name: "Update Field" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        options: TEAM.options,
        description: "Where they work",
      })
    );
  });
});
