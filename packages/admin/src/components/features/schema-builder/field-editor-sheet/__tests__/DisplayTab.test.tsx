// Why: PR E1 renames Admin tab to Display, removes the Position field
// (no Sidebar support), and lays Read-only + Hidden side-by-side in a
// 50/50 row. These tests lock those contracts.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { DisplayTab } from "../DisplayTab";

const baseField = (overrides: Partial<BuilderField> = {}): BuilderField => ({
  id: "f1",
  name: "title",
  label: "Title",
  type: "text",
  validation: {},
  ...overrides,
});

describe("DisplayTab", () => {
  it("renders Width segmented control", () => {
    render(<DisplayTab field={baseField()} onChange={vi.fn()} />);
    expect(screen.getByText(/^Width$/)).toBeInTheDocument();
  });

  it("does NOT render the Position field (removed in PR E1)", () => {
    render(<DisplayTab field={baseField()} onChange={vi.fn()} />);
    expect(screen.queryByText(/^Position$/)).toBeNull();
    expect(screen.queryByText(/^Sidebar$/)).toBeNull();
  });

  it("renders Read-only and Hidden switches with their helper taglines", () => {
    render(<DisplayTab field={baseField()} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Read only")).toBeInTheDocument();
    expect(screen.getByLabelText("Hidden")).toBeInTheDocument();
    // Helper text on each.
    expect(
      screen.getByText(/displayed but cannot be edited/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not shown in the record editor/i)
    ).toBeInTheDocument();
  });

  it("toggles readOnly via the switch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DisplayTab field={baseField()} onChange={onChange} />);
    await user.click(screen.getByLabelText("Read only"));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.readOnly).toBe(true);
  });

  it("still renders the Conditional visibility section (kept in PR E1)", () => {
    // PR E2 will rebuild the JSON textarea into a visual rule builder.
    // For PR E1 it stays as-is.
    render(<DisplayTab field={baseField()} onChange={vi.fn()} />);
    expect(screen.getByText(/conditional visibility/i)).toBeInTheDocument();
  });
});
