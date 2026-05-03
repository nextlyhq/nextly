// Why: shell tests lock the off-canvas contract — 4 tabs render, footer
// shows Apply/Cancel + a Delete (only for non-system, non-readOnly fields),
// the readOnly mode swaps the footer to a single Close button. Tab content
// rendering is covered separately in each tab's own test.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

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
        siblingNames={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    for (const name of ["General", "Validation", "Admin", "Advanced"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("renders Apply and Cancel buttons in default (editable) mode", () => {
    render(
      <FieldEditorSheet
        open
        mode="edit"
        field={userField}
        siblingNames={[]}
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
        siblingNames={[]}
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
        siblingNames={[]}
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
        siblingNames={[]}
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

  it("invokes onApply with the current draft when Apply is clicked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <FieldEditorSheet
        open
        mode="edit"
        field={userField}
        siblingNames={[]}
        onCancel={vi.fn()}
        onApply={onApply}
        onDelete={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledWith(userField);
  });
});
