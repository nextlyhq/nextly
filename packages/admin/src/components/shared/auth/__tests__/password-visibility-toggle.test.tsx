import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PasswordVisibilityToggle } from "../PasswordVisibilityToggle";

/**
 * The eleven copies of this button had drifted into two behaviours: four
 * carried an accessible name, seven carried `tabIndex={-1}` and none. These
 * hold the properties that made the seven unusable — a name, and a place in
 * the tab order — so one implementation cannot quietly lose them again.
 */
describe("PasswordVisibilityToggle", () => {
  it("names itself for the state it will move to", async () => {
    const { rerender } = render(
      <PasswordVisibilityToggle visible={false} onToggle={vi.fn()} />
    );

    expect(screen.getByRole("button", { name: "Show password" })).toBeVisible();

    rerender(<PasswordVisibilityToggle visible onToggle={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Hide password" })).toBeVisible();
  });

  // The defect that motivated this component: `tabIndex={-1}` took the control
  // out of the tab order, so a keyboard user could not reach the one control
  // that exists to check what they typed.
  it("is reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<PasswordVisibilityToggle visible={false} onToggle={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).not.toHaveAttribute("tabindex", "-1");

    await user.tab();
    expect(toggle).toHaveFocus();
  });

  it("reports the toggle rather than deciding the state itself", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<PasswordVisibilityToggle visible={false} onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: "Show password" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // A submit button inside a form would submit it; this one must not.
  it("does not submit the form it sits in", () => {
    render(<PasswordVisibilityToggle visible={false} onToggle={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Show password" })
    ).toHaveAttribute("type", "button");
  });
});
