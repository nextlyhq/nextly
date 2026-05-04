import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { NestedAddButton } from "../NestedAddButton";

describe("NestedAddButton", () => {
  it("renders parent name in label", () => {
    render(<NestedAddButton parentLabel="Hero Sections" onClick={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /add field inside hero sections/i })
    ).toBeInTheDocument();
  });

  it("calls onClick when pressed", async () => {
    const handler = vi.fn();
    render(<NestedAddButton parentLabel="Hero Sections" onClick={handler} />);
    await userEvent.click(
      screen.getByRole("button", { name: /add field inside hero sections/i })
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("uses dashed bordered visual treatment (Q6 button B)", () => {
    render(<NestedAddButton parentLabel="x" onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /add field inside x/i });
    // Why: Q6 chose button B (smaller dashed bordered box). The smoke
    // check here is structural -- the styling lives in the class names
    // that produce the dashed border.
    expect(btn.className).toMatch(/border-dashed/);
  });
});
