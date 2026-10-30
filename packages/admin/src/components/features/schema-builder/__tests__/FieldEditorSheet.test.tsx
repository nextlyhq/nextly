// Why: shell tests lock the off-canvas contract — 4 tabs render, the footer
// shows [Cancel] [Apply] only, the confirming action last (Delete moved to the header as a trash icon
// for non-system, non-readOnly fields in edit mode), and readOnly mode
// swaps the footer to a single Close button. Tab content rendering is
// covered separately in each tab's own test.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { FieldEditorSheet } from "../FieldEditorSheet";
import type { BuilderField } from "../types";

// The installed plugins the sheet sees, so a test can contribute a field type
// the way /admin-meta does. Empty by default, which is what the other tests
// in this file render with.
const branding = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
}));

const userField: BuilderField = {
  id: "f-1",
  name: "excerpt",
  label: "Excerpt",
  type: "textarea",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

const systemField: BuilderField = {
  id: "system_title",
  name: "title",
  label: "Title",
  type: "text",
  isSystem: true,
  validation: { required: true },
  admin: { width: "100%" },
};

describe("FieldEditorSheet — shell", () => {
  it("renders all four tabs", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    // PR E1 (2026-05-03): renamed "Admin" -> "Display" per feedback
    // Section 4. The tab `value` stays "admin" so this assertion uses
    // the visible label, not the value.
    for (const name of ["General", "Validation", "Display", "Advanced"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("renders Apply and Cancel buttons in default (editable) mode", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /^cancel$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^apply$/i })
    ).toBeInTheDocument();
  });

  it("hides Delete for system fields", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={systemField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: /delete field/i })
    ).not.toBeInTheDocument();
  });

  it("shows Delete for user fields", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /delete field/i })
    ).toBeInTheDocument();
  });

  it("swaps the footer to a single Close button in readOnly mode", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        readOnly
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /^close$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^apply$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete field/i })
    ).not.toBeInTheDocument();
  });

  it("opens a confirm dialog before firing onDelete from the header trash icon", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={onDelete}
      />
    );
    // Click trash icon in header — opens confirm, does NOT fire onDelete yet
    await user.click(screen.getByRole("button", { name: /delete field/i }));
    expect(onDelete).not.toHaveBeenCalled();
    // Confirm dialog appears with the destructive CTA
    expect(
      screen.getByRole("alertdialog", { name: /delete this field\?/i })
    ).toBeInTheDocument();
    // Confirm fires onDelete
    await user.click(screen.getByRole("button", { name: /^delete field$/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not fire onDelete when the user cancels the confirm dialog", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={onDelete}
      />
    );
    await user.click(screen.getByRole("button", { name: /delete field/i }));
    // Cancel the AlertDialog (different button than the sheet footer's Cancel)
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("invokes onApply with the current draft when Apply is clicked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={onApply}
        onDelete={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledWith(userField);
  });
});

describe("FieldEditorSheet -- isInsideRepeatingAncestor prop (PR E3)", () => {
  it("forwards the prop to AdvancedTab so unique is disabled", async () => {
    const user = userEvent.setup();
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        isInsideRepeatingAncestor
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await user.click(screen.getByRole("tab", { name: /advanced/i }));
    expect(screen.getByRole("switch", { name: /^unique$/i })).toBeDisabled();
  });

  it("leaves unique enabled when the prop is omitted", async () => {
    const user = userEvent.setup();
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await user.click(screen.getByRole("tab", { name: /advanced/i }));
    expect(
      screen.getByRole("switch", { name: /^unique$/i })
    ).not.toBeDisabled();
  });

  // The footer puts Cancel before the confirming action (Add field / Apply),
  // the one order every Builder dialog and panel uses, and is drawn by the
  // shared sheet footer, right-aligned like the dialogs' footers. These two
  // tests lock that contract so swapping the buttons back breaks loudly.
  it("renders Cancel before the Add field button in DOM order in create mode", () => {
    render(
      <FieldEditorSheet
        open
        mode="create"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const addBtn = screen.getByRole("button", { name: /^add field$/i });
    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    // compareDocumentPosition returns DOCUMENT_POSITION_FOLLOWING (0x04) when
    // the add field button comes AFTER the cancel button in the DOM.
    expect(
      cancelBtn.compareDocumentPosition(addBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("uses justify-end on the footer container, as the dialogs' footers do", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={userField}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const cancelBtn = screen.getByRole("button", { name: /^cancel$/i });
    // Footer is the closest <div> ancestor of the Cancel button.
    const footer = cancelBtn.closest("div");
    expect(footer).not.toBeNull();
    expect(footer!.className).toMatch(/justify-end/);
    expect(footer!.className).not.toMatch(/justify-start/);
  });
});

// The header names the field's type the way the picker that created it did,
// not by the internal id that stored data uses.
describe("FieldEditorSheet -- header type name", () => {
  const headerType = () => screen.getByText("Type:").parentElement?.textContent;

  it("the header shows the plain type name", () => {
    branding.current = {};
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={{ ...userField, type: "richText" }}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(headerType()).toBe("Type: Rich text");
    expect(headerType()).not.toMatch(/richText/);
  });

  it("names a plugin-contributed type by the label the picker shows", () => {
    branding.current = {
      plugins: [
        {
          name: "acme",
          enabled: true,
          fieldTypes: [
            { type: "acme-colour", label: "Colour swatch", storage: "text" },
          ],
        },
      ],
    };
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={{ ...userField, type: "acme-colour" }}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(headerType()).toBe("Type: Colour swatch");
    branding.current = {};
  });
});
