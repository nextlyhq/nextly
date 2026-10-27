/**
 * A card's menu at rest: its quick setting, offered at every size, Settings, and Refresh.
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
        settingsDisabled={false}
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
        settingsDisabled={false}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Card menu for Activity" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps Refresh in reach while the card's settings cannot be saved", async () => {
    // The menu is in the same place on every card, and a write in flight
    // blocks only Settings, not asking again for the card's data.
    const onRefresh = vi.fn();
    render(
      <CardMenu
        title="Activity"
        onOpenSettings={vi.fn()}
        onRefresh={onRefresh}
        settingsDisabled
      />
    );
    const trigger = screen.getByRole("button", {
      name: "Card menu for Activity",
    });
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: /Settings/ })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /Refresh/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers no Refresh for a card that asks for no data", async () => {
    render(
      <CardMenu
        title="Note"
        onOpenSettings={vi.fn()}
        settingsDisabled={false}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Card menu for Note" })
    );
    expect(screen.queryByRole("menuitem", { name: /Refresh/ })).toBeNull();
  });
});
