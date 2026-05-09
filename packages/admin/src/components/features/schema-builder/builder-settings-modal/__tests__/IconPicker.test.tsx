// Why: lock the contract for the extracted IconPicker — opens a popover with
// the curated list, search filters in place, and selecting an icon fires
// onChange with the icon name (a Lucide identifier).
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { IconPicker } from "../IconPicker";

describe("IconPicker", () => {
  it("shows the placeholder label when no value is selected", () => {
    render(<IconPicker onChange={() => {}} />);
    expect(screen.getByText(/select icon/i)).toBeInTheDocument();
  });

  it("shows the chosen icon's label when a value is provided", () => {
    render(<IconPicker value="FileText" onChange={() => {}} />);
    // FileText maps to "Document" in the curated list.
    expect(screen.getByText(/document/i)).toBeInTheDocument();
  });

  it("opens the popover and fires onChange when an icon is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IconPicker onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /select icon/i }));

    // Search to narrow the list and avoid clicking the wrong tile.
    await user.type(screen.getByPlaceholderText(/search icons/i), "Star");
    const starButton = screen.getByTitle("Star");
    await user.click(starButton);

    expect(onChange).toHaveBeenCalledWith("Star");
  });
});
