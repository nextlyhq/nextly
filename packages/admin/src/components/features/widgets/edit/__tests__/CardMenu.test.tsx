/**
 * A card's menu at rest: its quick setting, offered at every size, and Settings.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CardMenu } from "../CardMenu";
import type { QuickSetting } from "../quick-setting";

const RANGE: QuickSetting = {
  name: "range",
  type: "select",
  label: "Date range",
  quick: true,
  options: [
    { label: "Last 7 days", value: "7d" },
    { label: "Last 30 days", value: "30d" },
  ],
};

describe("a card's menu at rest", () => {
  it("offers the quick setting and changes it from the menu", async () => {
    const change = vi.fn();
    render(
      <CardMenu
        title="Activity"
        quick={{ setting: RANGE, value: "30d", change }}
        onOpenSettings={vi.fn()}
        disabled={false}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Card menu for Activity" })
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Last 30 days" })
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "Last 7 days" })
    );
    expect(change).toHaveBeenCalledWith("7d");
  });

  it("opens the card's settings", async () => {
    const onOpenSettings = vi.fn();
    render(
      <CardMenu
        title="Activity"
        onOpenSettings={onOpenSettings}
        disabled={false}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Card menu for Activity" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("cannot be opened while the card's settings cannot be saved", () => {
    render(<CardMenu title="Activity" onOpenSettings={vi.fn()} disabled />);
    expect(
      screen.getByRole("button", { name: "Card menu for Activity" })
    ).toBeDisabled();
  });
});
