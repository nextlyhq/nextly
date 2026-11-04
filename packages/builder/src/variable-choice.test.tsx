// @vitest-environment jsdom

/**
 * The variable pieces on their own, as a field mounts them: the ◇ and its
 * list, the chip, and the unit menu's item.
 *
 * What the panel does with them, which fields get them and what is stored,
 * is in `style-variables-panel.test.tsx`.
 *
 * @module variable-choice.test
 */
import {
  STYLE_CATALOG,
  type SiteTokenSet,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";
import { DropdownMenu, DropdownMenuContent } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  VariableChip,
  VariableChoice,
  VariablesMenuItem,
} from "./variable-choice";

afterEach(cleanup);

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

interface CatalogEntry {
  readonly property: string;
  readonly shape: StyleLeaf;
}

const leafOf = (property: string): StyleLeaf => {
  const found = (STYLE_CATALOG as unknown as readonly CatalogEntry[]).find(
    candidate => candidate.property === property
  );
  if (found === undefined) throw new Error(`no catalog entry for ${property}`);
  return found.shape;
};

const FONT_SIZE = leafOf("fontSize");
const OPACITY = leafOf("opacity");
/** A length with no family of its own, so every length is offered there. */
const WIDTH = leafOf("width");

const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "font-size.display", kind: "dimension", values: { light: "48px" } },
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
  ],
};

const trigger = (label = "Font size"): HTMLElement =>
  screen.getByRole("button", { name: `Variables for ${label}` });

describe("the ◇ beside a field", () => {
  it("opens the variables by name, each with its value", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger());
    const list = screen.getByRole("listbox", { name: "Variables" });
    expect(
      within(list).getByRole("option", { name: "Display 48px" })
    ).toBeDefined();
    expect(
      within(list).getByRole("option", { name: "Body 16px" })
    ).toBeDefined();
  });

  it("hands back the identity picked, and closes", () => {
    const onPick = vi.fn();
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Font size"
        onPick={onPick}
      />
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    expect(onPick).toHaveBeenCalledWith("font-size.display");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without picking", () => {
    const onPick = vi.fn();
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Font size"
        onPick={onPick}
      />
    );
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("marks the variable the field holds, and stays in view while it does", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound
        current="font-size.body"
        label="Font size"
        onPick={vi.fn()}
      />
    );
    expect(trigger().hasAttribute("data-bound")).toBe(true);
    fireEvent.click(trigger());
    expect(
      screen
        .getByRole("option", { name: "Body 16px" })
        .hasAttribute("data-current")
    ).toBe(true);
  });

  it("draws a type size at its size and a length as a bar scaled to it", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger());
    const display = screen.getByRole("option", { name: "Display 48px" });
    // 48px capped to what a row holds; the body size at its own 16px.
    expect(
      (display.querySelector(".nx-variable-choice__name") as HTMLElement).style
        .fontSize
    ).toBe("28px");
    const body = screen.getByRole("option", { name: "Body 16px" });
    expect(
      (body.querySelector(".nx-variable-choice__name") as HTMLElement).style
        .fontSize
    ).toBe("16px");
  });

  it("draws a length as a bar scaled to it, capped", () => {
    render(
      <VariableChoice
        leaf={WIDTH}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Width"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger("Width"));
    const bar = screen
      .getByRole("option", { name: "Sm 8px" })
      .querySelector(".nx-variable-choice__bar") as HTMLElement;
    expect(bar.style.inlineSize).toBe("8px");
    const wide = screen
      .getByRole("option", { name: "Content width 72rem" })
      .querySelector(".nx-variable-choice__bar") as HTMLElement;
    expect(wide.style.inlineSize).toBe("64px");
  });

  it("opens on the first row drawn, and the arrows follow the drawn order", () => {
    // Grouped as Design groups them, so the order drawn is not the order the
    // site lists them in: the engine's own Content width comes first there
    // and is drawn last, under Other.
    render(
      <VariableChoice
        leaf={WIDTH}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Width"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger("Width"));
    const drawn = screen
      .getAllByRole("option")
      .map(option => option.textContent ?? "");
    // The type sizes first and the engine's own Content width under Other,
    // late, though the site's list starts with it.
    expect(drawn.slice(0, 2)).toEqual(["Display 48px", "Body 16px"]);
    expect(drawn.indexOf("Content width 72rem")).toBeGreaterThan(
      drawn.indexOf("Sm 8px")
    );
    const selected = (): string | null =>
      screen
        .getAllByRole("option")
        .find(option => option.getAttribute("aria-selected") === "true")
        ?.textContent ?? null;
    expect(selected()).toBe("Display 48px");
    const list = screen.getByRole("listbox", { name: "Variables" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(selected()).toBe("Body 16px");
    fireEvent.keyDown(list, { key: "End" });
    expect(selected()).toBe(drawn.at(-1));
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(selected()).toBe(drawn.at(-2));
  });

  it("opens on the variable the field holds, wherever it is drawn", () => {
    render(
      <VariableChoice
        leaf={WIDTH}
        tokens={TOKENS}
        bound
        current="space.sm"
        label="Width"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger("Width"));
    expect(
      screen
        .getByRole("option", { name: "Sm 8px" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });

  it("is shown at rest on an empty field, and not on one holding a value", () => {
    const { rerender } = render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        empty
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    expect(trigger().hasAttribute("data-empty")).toBe(true);
    rerender(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        empty={false}
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    expect(trigger().hasAttribute("data-empty")).toBe(false);
  });

  it("searches once the list is long", () => {
    const many: SiteTokenSet = {
      tokens: Array.from({ length: 9 }, (_, at) => ({
        name: `space.step-${String(at)}`,
        kind: "dimension" as const,
        values: { light: `${String(at * 4)}px` },
      })),
    };
    render(
      <VariableChoice
        leaf={WIDTH}
        tokens={many}
        bound={false}
        current={undefined}
        label="Width"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger("Width"));
    const search = screen.getByRole("combobox", { name: "Search variables" });
    fireEvent.change(search, { target: { value: "step 3" } });
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Step 3 12px"]);
  });

  it("draws nothing where the site has no variable the field takes", () => {
    // Opacity takes a number variable, and the site has none.
    const { container } = render(
      <VariableChoice
        leaf={OPACITY}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Opacity"
        onPick={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing where the host supplied no variables", () => {
    const { container } = render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={undefined}
        bound={false}
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the chip a held variable shows", () => {
  it("names the variable, with its value, and clears as a colour's Clear does", () => {
    const onClear = vi.fn();
    render(
      <VariableChip
        leaf={FONT_SIZE}
        tokens={TOKENS}
        identity="font-size.display"
        label="Font size"
        onClear={onClear}
      />
    );
    const chip = screen.getByRole("group", { name: "Font size" });
    expect(chip.textContent).toBe("Display 48px");
    fireEvent.click(
      within(chip).getByRole("button", {
        name: "Clear Font size",
      })
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shows the stored identity for a variable the site no longer has", () => {
    render(
      <VariableChip
        leaf={FONT_SIZE}
        tokens={TOKENS}
        identity="font-size.gone"
        label="Font size"
        onClear={vi.fn()}
      />
    );
    expect(screen.getByRole("group").textContent).toBe("font-size.gone");
  });
});

describe("the unit menu's item", () => {
  // Not mounted by any field yet: the unit menu that will hold it is still to
  // come, so this is its contract, drawn inside a menu as that menu will.
  function inMenu(item: React.ReactNode) {
    return render(
      <DropdownMenu open>
        <DropdownMenuContent>{item}</DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it("offers the variables from the menu, and the same list", () => {
    const onPick = vi.fn();
    inMenu(
      <VariablesMenuItem
        leaf={FONT_SIZE}
        tokens={TOKENS}
        current={undefined}
        label="Font size"
        onPick={onPick}
      />
    );
    const item = screen.getByRole("menuitem", {
      name: "Use a variable for Font size",
    });
    expect(item.textContent).toContain("Use a variable…");
    fireEvent.keyDown(item, { key: "ArrowRight" });
    // A menu opened by keyboard focuses its own content, which jsdom's Radix
    // does not do by itself: done here, focus must pass on to the list, so
    // the arrows move through the variables rather than a menu with no items.
    const submenu = screen.getAllByRole("menu").at(-1) as HTMLElement;
    act(() => submenu.focus());
    expect(document.activeElement).toBe(
      screen.getByRole("listbox", { name: "Variables" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Display 48px" }));
    expect(onPick).toHaveBeenCalledWith("font-size.display");
  });

  it("is absent where nothing would be offered", () => {
    inMenu(
      <VariablesMenuItem
        leaf={OPACITY}
        tokens={TOKENS}
        current={undefined}
        label="Opacity"
        onPick={vi.fn()}
      />
    );
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

describe("a fluid variable in the list and on the chip", () => {
  const FLUID: SiteTokenSet = {
    tokens: [
      {
        name: "space.gutter-fluid",
        kind: "dimension",
        values: { light: "clamp(1rem, 4vw, 3rem)" },
      },
    ],
  };

  it("lists it as Fluid with a fluid bar, its whole value on hover", () => {
    render(
      <VariableChoice
        leaf={WIDTH}
        tokens={FLUID}
        bound={false}
        current={undefined}
        label="Width"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger("Width"));
    const row = screen.getByRole("option", { name: "Gutter fluid Fluid" });
    expect(row.title).toBe("Gutter fluid clamp(1rem, 4vw, 3rem)");
    expect(
      row.querySelector(".nx-variable-choice__bar[data-fluid]")
    ).not.toBeNull();
  });

  it("keeps the whole name and value on the list row, however the value is cut", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        bound={false}
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger());
    // On the row, which never collapses, and in its name.
    expect(screen.getByRole("option", { name: "Display 48px" }).title).toBe(
      "Display 48px"
    );
  });

  it("puts the whole name and value in the chip's tooltip", () => {
    render(
      <VariableChip
        leaf={FONT_SIZE}
        tokens={TOKENS}
        identity="font-size.display"
        label="Font size"
        onClear={vi.fn()}
      />
    );
    // On the chip itself, which never collapses, and in what it reads out.
    const chip = screen.getByRole("group", { name: "Font size" });
    expect(chip.title).toBe("Display 48px");
    expect(chip.textContent).toBe("Display 48px");
  });
});
