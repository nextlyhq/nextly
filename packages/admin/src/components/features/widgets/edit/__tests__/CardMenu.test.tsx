/**
 * A card's one menu: at rest Settings…, Refresh and Remove, in that order, each where the card
 * has it; while customising the same, with Move earlier and Move later before Remove. Neither
 * offers a Width or a Height: the width is set in the settings drawer, and a card is as tall as
 * its content. Remove asks nothing.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CardActionsMenu } from "../CardActionsMenu";
import { CardMenu, removeLabelFor, type CardMenuProps } from "../CardMenu";

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
  it("lists Settings…, Refresh and Remove, in that order, and no size", async () => {
    draw({
      onOpenSettings: vi.fn(),
      onRefresh: vi.fn(),
      onRemove: vi.fn(),
    });
    const { menu } = await open();
    expect(itemNames(menu)).toEqual(["Settings…", "Refresh", "Remove"]);
    expect(within(menu).queryByRole("menuitemradio")).toBeNull();
    expect(within(menu).queryByText(/Width|Height/)).toBeNull();
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

  it("calls Remove Hide setup on the setup card, and it removes the card as Remove does", async () => {
    expect(removeLabelFor("core/setup")).toBe("Hide setup");
    expect(removeLabelFor("core/note")).toBeUndefined();
    const onRemove = vi.fn();
    draw({ onRemove, removeLabel: removeLabelFor("core/setup") });
    const { user, menu } = await open();
    expect(itemNames(menu)).toEqual(["Hide setup"]);
    await user.click(
      within(menu).getByRole("menuitem", { name: "Hide setup" })
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps Refresh in reach while the card's settings cannot be saved", async () => {
    // The menu is in the same place on every card, and a write in flight
    // blocks only Settings, not asking again for the card's data.
    const onRefresh = vi.fn();
    draw({
      onOpenSettings: vi.fn(),
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

describe("a card's menu while customising", () => {
  function drawCustomising(
    can = { start: true, earlier: true, later: true, end: true }
  ) {
    const on = {
      move: vi.fn(),
      remove: vi.fn(),
      openSettings: vi.fn(),
      refresh: vi.fn(),
    };
    render(
      <CardActionsMenu
        title="Activity"
        can={can}
        disabled={false}
        triggerRef={() => {}}
        on={on}
      />
    );
    return on;
  }

  async function openCustomising(user = userEvent.setup()) {
    await user.click(
      screen.getByRole("button", { name: "Card actions for Activity" })
    );
    return { user, menu: await screen.findByRole("menu") };
  }

  it("lists Settings…, Refresh, Move earlier, Move later and Remove, in that order, and no size", async () => {
    drawCustomising();
    const { menu } = await openCustomising();
    expect(itemNames(menu)).toEqual([
      "Settings…",
      "Refresh",
      "Move earlier",
      "Move later",
      "Remove",
    ]);
    expect(within(menu).queryByRole("menuitemradio")).toBeNull();
    expect(within(menu).queryByText(/Width|Height/)).toBeNull();
  });

  it("opens the card's settings and moves it, each by its own item", async () => {
    const on = drawCustomising();
    let opened = await openCustomising();
    await opened.user.click(
      within(opened.menu).getByRole("menuitem", { name: "Settings…" })
    );
    expect(on.openSettings).toHaveBeenCalledTimes(1);
    opened = await openCustomising(opened.user);
    await opened.user.click(
      within(opened.menu).getByRole("menuitem", { name: "Move later" })
    );
    expect(on.move).toHaveBeenCalledWith("later");
  });

  it("calls Remove Hide setup on the setup card, as the menu at rest does", async () => {
    render(
      <CardActionsMenu
        title="Activity"
        can={{ start: true, earlier: true, later: true, end: true }}
        disabled={false}
        triggerRef={() => {}}
        removeLabel={removeLabelFor("core/setup")}
        on={{ move: vi.fn(), remove: vi.fn(), openSettings: vi.fn() }}
      />
    );
    const { menu } = await openCustomising();
    expect(itemNames(menu).at(-1)).toBe("Hide setup");
  });

  it("keeps a move that would not move the card in its place, disabled", async () => {
    drawCustomising({ start: false, earlier: false, later: true, end: true });
    const { menu } = await openCustomising();
    expect(
      within(menu).getByRole("menuitem", { name: "Move earlier" })
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(menu).getByRole("menuitem", { name: "Move later" })
    ).not.toHaveAttribute("aria-disabled");
  });
});
