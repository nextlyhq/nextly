// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EditingBar,
  type EditingBarProps,
  sharedUsageLine,
  stateLookLine,
} from "./editing-bar";

afterEach(() => cleanup());

const CARD = { id: "c-card", name: "Card", className: ".nx-c-card" };
const SAVE_FIRST = "Change a style first, then save it to reuse it.";

/** The bar with what every test leaves alone filled in. */
function bar(props: Partial<EditingBarProps> = {}): React.JSX.Element {
  return (
    <EditingBar
      target={{ kind: "block" }}
      device="Desktop"
      deviceReach="All devices"
      state="base"
      apply={{ picker: () => null }}
      save={{ run: () => {} }}
      onTargetChange={() => {}}
      {...props}
    />
  );
}

/** Open the target chip's menu, as a pointer press does. */
function openTargetMenu(): HTMLElement {
  fireEvent.pointerDown(screen.getByRole("button", { name: /^Editing: / }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.getByRole("menu");
}

/**
 * The menu's items in order, each by its label (its first line). jsdom joins
 * a name's inline parts with no space, so names are matched with `\s*`.
 */
function itemLabels(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map(
    item =>
      item.querySelector(".nx-editing-bar__item-words > span")?.textContent ??
      ""
  );
}

describe("the editing bar's chips", () => {
  it("says this block in words beside the pink, with its name for a reader", () => {
    render(bar());
    const chip = screen.getByRole("button", { name: "Editing: This block" });
    expect(chip.textContent).toBe("●This block");
    expect(chip.dataset.tone).toBe("block");
    // A menu button: the menu is where the target is chosen.
    expect(chip.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("says a shared target's name in words beside the green", () => {
    render(
      bar({ target: { kind: "shared", ...CARD, reach: "" }, chips: [CARD] })
    );
    const chip = screen.getByRole("button", {
      name: "Editing: shared style Card",
    });
    expect(chip.textContent).toBe("◆Card");
    expect(chip.dataset.tone).toBe("shared");
  });

  it("keeps a long shared name whole in the chip's tooltip and name", () => {
    const name = "A very long shared style name for the hero buttons";
    const long = { ...CARD, name };
    render(
      bar({ target: { kind: "shared", ...long, reach: "" }, chips: [long] })
    );
    const chip = screen.getByRole("button", {
      name: `Editing: shared style ${name}`,
    });
    expect(chip.getAttribute("title")).toBe(`Shared style ${name}, .nx-c-card`);
  });

  it("reports the device without choosing it, and says where it is chosen", () => {
    const view = render(bar());
    const chip = view.container.querySelector<HTMLElement>(
      ".nx-editing-bar__device"
    );
    expect(chip?.querySelector("[data-edit-device]")?.textContent).toBe(
      "Desktop"
    );
    // Not a control: no button, nothing to tab to.
    expect(chip?.tagName).toBe("SPAN");
    expect(chip?.closest("button")).toBeNull();
    expect(chip?.querySelector("button")).toBeNull();
    expect(chip?.hasAttribute("tabindex")).toBe(false);
    expect(chip?.textContent).toContain(
      "Changes here reach: All devices. The device is chosen in the top bar."
    );
  });

  it("is one tab stop for the target, then one for the state, and none for the device", () => {
    const view = render(
      bar({ stateControl: <button type="button">State: Normal</button> })
    );
    const stops = [
      ...view.container.querySelectorAll<HTMLElement>("button, [tabindex]"),
    ].filter(each => each.tabIndex >= 0);
    expect(stops.map(each => each.textContent)).toEqual([
      "●This block",
      "State: Normal",
    ]);
  });

  it("names the state in words, marked for its colour when not Normal", () => {
    const view = render(bar());
    const chip = () =>
      view.container.querySelector<HTMLElement>(".nx-editing-bar__state-chip");
    expect(chip()?.dataset.state).toBe("base");
    expect(chip()?.querySelector("[data-edit-state]")?.textContent).toBe(
      "Normal"
    );
    view.rerender(bar({ state: "hover" }));
    expect(chip()?.dataset.state).toBe("hover");
    expect(chip()?.querySelector("[data-edit-state]")?.textContent).toBe(
      "Hover"
    );
  });

  it("adds the usage line only while a shared style is the target", () => {
    const view = render(bar({ chips: [CARD] }));
    expect(screen.queryByText(/^Shared style/)).toBeNull();
    view.rerender(
      bar({
        target: {
          kind: "shared",
          ...CARD,
          reach: "3 blocks on this page · on 2 pages",
        },
        chips: [CARD],
      })
    );
    expect(
      screen.getByText(
        "Shared style · 3 blocks on this page · on 2 pages. Changes here change all of them."
      )
    ).toBeTruthy();
  });
});

describe("the bar's words", () => {
  it("says what a shared target reaches, before and after its count", () => {
    expect(sharedUsageLine("")).toBe(
      "Shared style. Changes here change all of them."
    );
    expect(sharedUsageLine("Not used anywhere")).toBe(
      "Shared style · not used anywhere. Changes here change all of them."
    );
  });

  it("says which look a state other than Normal edits", () => {
    expect(stateLookLine("hover")).toBe(
      "You are editing the Hover look. Normal stays as it is."
    );
    expect(stateLookLine("active")).toBe(
      "You are editing the Pressed look. Normal stays as it is."
    );
  });
});

describe("the target chip's menu", () => {
  const actions = { onDetach: () => {}, onRemove: () => {} };

  it("lists the same items in the same places before and after an edit", () => {
    const view = render(
      bar({ chips: [CARD], ...actions, save: { held: SAVE_FIRST } })
    );
    const before = itemLabels(openTargetMenu());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    // The edit enables Save; nothing is added or taken away.
    view.rerender(bar({ chips: [CARD], ...actions, save: { run: () => {} } }));
    const after = itemLabels(openTargetMenu());
    expect(before).toEqual([
      "● This block",
      "◆ Card",
      "Detach Card",
      "Remove Card",
      "Apply a shared style…",
      "Save as shared style…",
    ]);
    expect(after).toEqual(before);
  });

  it("holds Save with its reason until there is something to save", () => {
    render(bar({ save: { held: SAVE_FIRST } }));
    const save = within(openTargetMenu()).getByRole("menuitem", {
      name: /^Save as shared style…/,
    });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.textContent).toContain(SAVE_FIRST);
  });

  it("runs Save from the menu once it can", () => {
    const run = vi.fn();
    render(bar({ save: { run } }));
    fireEvent.click(
      within(openTargetMenu()).getByRole("menuitem", {
        name: /^Save as shared style…/,
      })
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it("lists a worn style to switch to, with Detach and Remove beside it", () => {
    const onTargetChange = vi.fn();
    const onDetach = vi.fn();
    const onRemove = vi.fn();
    render(bar({ chips: [CARD], onTargetChange, onDetach, onRemove }));
    const menu = openTargetMenu();
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: /This block/ })
        .getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Card/ }));
    expect(onTargetChange).toHaveBeenCalledWith("c-card");

    fireEvent.click(
      within(openTargetMenu()).getByRole("menuitem", { name: /^Detach\s*Card/ })
    );
    expect(onDetach).toHaveBeenCalledWith("c-card");
    fireEvent.click(
      within(openTargetMenu()).getByRole("menuitem", { name: /^Remove\s*Card/ })
    );
    expect(onRemove).toHaveBeenCalledWith("c-card");
  });

  it("holds a worn style with the block's reason when its design is held", () => {
    render(
      bar({
        chips: [CARD],
        onRemove: () => {},
        targetHeld: "This block is locked.",
        chipActionsHeld: "This block is locked.",
      })
    );
    const menu = openTargetMenu();
    const card = within(menu).getByRole("menuitemradio", { name: /Card/ });
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(card.textContent).toContain("This block is locked.");
    expect(
      within(menu)
        .getByRole("menuitem", { name: /^Remove\s*Card/ })
        .getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("asks why Detach is held only once the menu is open", () => {
    // Asking plans the whole detach, so it waits for a reader to look: the
    // bar draws on every inspector render, and the menu is rarely open.
    const detachHeld = vi.fn((): string | undefined => "Held for a reason.");
    const view = render(bar({ chips: [CARD], onDetach: () => {}, detachHeld }));
    view.rerender(bar({ chips: [CARD], onDetach: () => {}, detachHeld }));
    expect(detachHeld).not.toHaveBeenCalled();

    const menu = openTargetMenu();
    expect(detachHeld).toHaveBeenCalledWith("c-card");
    expect(
      within(menu).getByRole("menuitem", { name: /^Detach\s*Card/ }).textContent
    ).toContain("Held for a reason.");
  });

  it("returns to this block on Escape from a shared target", () => {
    const onTargetChange = vi.fn();
    render(
      bar({
        target: { kind: "shared", ...CARD, reach: "" },
        chips: [CARD],
        onTargetChange,
      })
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Editing: shared style Card" }),
      { key: "Escape" }
    );
    expect(onTargetChange).toHaveBeenCalledWith(null);
  });
});
