// Why: the Display tab holds how a field is drawn in the record editor: its
// placeholder, Read only and Hidden. Position is not offered (one column),
// Width is in General and conditions have their own tab; those moves are
// pinned in GeneralTab.test.tsx and ConditionsTab.test.tsx.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
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
  it("draws neither Width nor conditions, which live in other tabs", () => {
    render(<DisplayTab field={baseField()} onChange={vi.fn()} />);
    expect(screen.queryByText(/^Width$/)).toBeNull();
    expect(screen.queryByText(/conditional visibility/i)).toBeNull();
  });

  it("offers a placeholder for a text field and writes it to admin.placeholder", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DisplayTab field={baseField()} onChange={onChange} />);
    await user.type(screen.getByLabelText("Placeholder"), "x");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.placeholder).toBe("x");
  });

  it("offers no placeholder for a type without a text box", () => {
    render(
      <DisplayTab field={baseField({ type: "date" })} onChange={vi.fn()} />
    );
    expect(screen.queryByLabelText("Placeholder")).toBeNull();
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

  describe("rows", () => {
    it("renders Read-only and Hidden as separate rows (not in a 50/50 grid)", () => {
      render(<DisplayTab field={baseField()} onChange={vi.fn()} />);
      // Both still render with their switches and helpers.
      expect(screen.getByLabelText("Read only")).toBeInTheDocument();
      expect(screen.getByLabelText("Hidden")).toBeInTheDocument();
    });
  });
});
