/**
 * A card's menu at rest: Settings, Size, Refresh and Remove, in that order, each where the card
 * has it. Size lists only what the widget's bounds allow; Remove asks nothing.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CardMenu, type CardMenuProps } from "../CardMenu";

/** Resizable from 3 by 2 up to 8 by 4. */
const BOUNDS = {
  default: { w: 4, h: 3 },
  min: { w: 3, h: 2 },
  max: { w: 8, h: 4 },
};

function draw(props: Partial<CardMenuProps> = {}) {
  render(<CardMenu title="Activity" settingsDisabled={false} {...props} />);
}

async function open(user = userEvent.setup()) {
  await user.click(
    screen.getByRole("button", { name: "Card menu for Activity" })
  );
  return { user, menu: await screen.findByRole("menu") };
}

/** Every item of the open menu, by its name, in the order drawn. */
function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map(item => item.textContent?.trim() ?? "");
}

describe("a card's menu at rest", () => {
  it("lists Settings, Size, Refresh and Remove, in that order", async () => {
    draw({
      onOpenSettings: vi.fn(),
      size: {
        size: { w: 4, h: 3 },
        bounds: BOUNDS,
        inPlace: false,
        onSetSize: vi.fn(),
      },
      onRefresh: vi.fn(),
      onRemove: vi.fn(),
    });
    const { menu } = await open();
    const names = itemNames(menu);
    expect(names).toHaveLength(5);
    expect(names[0]).toMatch(/^Settings/);
    // Size is the card's width and height, each a submenu of its choices.
    expect(names[1]).toMatch(/^Width/);
    expect(names[2]).toMatch(/^Height/);
    expect(names[3]).toBe("Refresh");
    expect(names[4]).toBe("Remove");
  });

  it("opens the card's settings", async () => {
    const onOpenSettings = vi.fn();
    draw({ onOpenSettings });
    const { user, menu } = await open();
    await user.click(within(menu).getByRole("menuitem", { name: /Settings/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("removes the card at once, asking nothing", async () => {
    const onRemove = vi.fn();
    draw({ onRemove });
    const { user, menu } = await open();
    await user.click(within(menu).getByRole("menuitem", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    // No confirmation of any kind: Undo is the notice's.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers only the sizes the widget's bounds allow, and changes the size by them", async () => {
    const onSetSize = vi.fn();
    draw({
      size: { size: { w: 4, h: 3 }, bounds: BOUNDS, inPlace: true, onSetSize },
    });
    const { user, menu } = await open();
    const widths = within(menu)
      .getAllByRole("menuitemradio")
      .map(item => item.getAttribute("aria-label"));
    expect(widths).toEqual([
      "Quarter width, 3 columns",
      "Third width, 4 columns",
      "Half width, 6 columns",
      "Two thirds width, 8 columns",
      "2 rows",
      "3 rows",
      "4 rows",
    ]);
    // By keyboard: jsdom has no geometry for a pointer to cross the items.
    within(menu)
      .getByRole("menuitemradio", { name: "Half width, 6 columns" })
      .focus();
    await user.keyboard("{Enter}");
    expect(onSetSize).toHaveBeenCalledWith({ w: 6, h: 3 });
  });

  it("keeps Refresh in reach while the card's settings cannot be saved", async () => {
    // The menu is in the same place on every card, and a write in flight
    // blocks only Settings and Size, not asking again for the card's data.
    const onRefresh = vi.fn();
    draw({
      onOpenSettings: vi.fn(),
      size: {
        size: { w: 4, h: 3 },
        bounds: BOUNDS,
        inPlace: false,
        onSetSize: vi.fn(),
      },
      onRefresh,
      settingsDisabled: true,
    });
    const trigger = screen.getByRole("button", {
      name: "Card menu for Activity",
    });
    expect(trigger).toBeEnabled();
    const { user, menu } = await open();
    expect(
      within(menu).getByRole("menuitem", { name: /Settings/ })
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(menu).getByRole("menuitem", { name: /Width/ })
    ).toHaveAttribute("aria-disabled", "true");
    await user.click(within(menu).getByRole("menuitem", { name: /Refresh/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("offers no Refresh for a card that asks for no data, and no Remove before it can be removed", async () => {
    draw({ onOpenSettings: vi.fn() });
    const { menu } = await open();
    expect(
      within(menu).queryByRole("menuitem", { name: /Refresh/ })
    ).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /Remove/ })).toBeNull();
  });

  it("gives focus back to its button when closed by Escape", async () => {
    draw({ onRefresh: vi.fn() });
    const { user } = await open();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Card menu for Activity" })
      ).toHaveFocus()
    );
  });
});
