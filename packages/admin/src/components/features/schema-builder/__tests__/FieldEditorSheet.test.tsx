// Why: shell tests lock the off-canvas contract — 4 tabs render, the footer
// shows [Cancel] [Apply] only (Delete moved to the header as a trash icon
// for non-system, non-readOnly fields in edit mode), and readOnly mode
// swaps the footer to a single Close button. Tab content rendering is
// covered separately in each tab's own test.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { FieldEditorSheet } from "../FieldEditorSheet";
import type { BuilderField } from "../types";

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

  // PR Task 7-2/3 (2026-05-09): footer is now left-aligned with the primary
  // action (Add field / Apply) rendered BEFORE Cancel in DOM order. These two
  // tests lock that contract so a future revert (`justify-end` or button
  // re-swap) breaks loudly instead of silently regressing the agreed UX.
  it("renders Add field button before Cancel in DOM order in create mode", () => {
    render(
      <FieldEditorSheet
        open
        mode="create"
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
    // the cancel button comes AFTER the add field button in the DOM.
    expect(
      addBtn.compareDocumentPosition(cancelBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("uses justify-start (not justify-end) on the footer container", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
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
    expect(footer!.className).toMatch(/justify-start/);
    expect(footer!.className).not.toMatch(/justify-end/);
  });
});
