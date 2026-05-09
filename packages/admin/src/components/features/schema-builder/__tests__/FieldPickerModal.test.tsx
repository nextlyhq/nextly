// Why: lock the picker contract — category headers render, search filters
// in place across all categories, excludedTypes hide rows, and clicking a
// row fires onSelect with the field type. The picker doesn't open the
// FieldEditorSheet itself; the parent page wires that flow.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { FieldPickerModal } from "../FieldPickerModal";

describe("FieldPickerModal", () => {
  it("renders category headers and field rows", () => {
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText(/^basic$/i)).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getByText(/^structured$/i)).toBeInTheDocument();
    expect(screen.getByText("Repeater")).toBeInTheDocument();
  });

  it("hides excluded types from any category", () => {
    render(
      <FieldPickerModal
        open
        excludedTypes={["relationship", "blocks"]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByText("Relationship")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocks")).not.toBeInTheDocument();
    // Category header for Relational disappears too when its only entry
    // was excluded.
    expect(screen.queryByText(/^relational$/i)).not.toBeInTheDocument();
  });

  it("filters by search query (name, hint, or category)", async () => {
    const user = userEvent.setup();
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    await user.type(screen.getByRole("textbox", { name: /search/i }), "rich");
    // PR C renamed `richText` label to "Editor"; the hint contains
    // "Lexical rich-text editor" so "rich" still matches the row.
    expect(screen.getByText("Editor")).toBeInTheDocument();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
  });

  it("calls onSelect with the field type when a row is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={onSelect}
      />
    );
    // Each field row is a button — find the one whose accessible name is
    // "Text" (the label).
    await user.click(screen.getByRole("button", { name: /^text\b/i }));
    expect(onSelect).toHaveBeenCalledWith("text");
  });

  it("shows an empty-state message when search matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    await user.type(
      screen.getByRole("textbox", { name: /search/i }),
      "zzznotamatch"
    );
    expect(screen.getByText(/no field types match/i)).toBeInTheDocument();
  });

  it("renders an icon + label + Add chip per row (PR C)", () => {
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    const row = screen.getByRole("button", { name: /^text\b/i });
    // The row contains an SVG icon and an "Add" chip.
    expect(row.querySelector("svg")).not.toBeNull();
    expect(row.textContent).toMatch(/Add/);
  });

  it("never lists blocks (removed in PR C)", () => {
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    // Block-specific copy that the legacy catalog used.
    expect(screen.queryByText(/heterogeneous block list/i)).toBeNull();
  });

  it("lists toggle (restored in PR C)", () => {
    render(
      <FieldPickerModal
        open
        excludedTypes={[]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("Toggle")).toBeInTheDocument();
  });
});
