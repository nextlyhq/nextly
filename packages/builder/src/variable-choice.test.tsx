// @vitest-environment jsdom

/**
 * The variable pieces on their own, as a field mounts them: the menu a field
 * with no menu of its own draws and its list, the green chip, and Unlink.
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

import type { SiteVariable } from "./style-colour";
import { unlinkedValue, VariableChip, VariableChoice } from "./variable-choice";

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

describe("the variables menu of a field with no menu of its own", () => {
  it("opens the variables by name, each with its value", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
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

  it("marks the variable the field holds", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        current="font-size.body"
        label="Font size"
        onPick={vi.fn()}
      />
    );
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
        current={undefined}
        label="Width"
        onPick={vi.fn()}
      />
    );
    fireEvent.click(trigger("Width"));
    const drawn = screen
      .getAllByRole("option")
      .map(option => option.textContent ?? "");
    // The type sizes first, the engine's built-in heading sizes leading, and
    // the engine's own Content width under Other, late, though the site's
    // list starts with it.
    expect(drawn.slice(0, 2)).toEqual(["H1 2.25rem", "H2 1.75rem"]);
    expect(drawn.indexOf("Content width 72rem")).toBeGreaterThan(
      drawn.indexOf("Sm 8px")
    );
    const selected = (): string | null =>
      screen
        .getAllByRole("option")
        .find(option => option.getAttribute("aria-selected") === "true")
        ?.textContent ?? null;
    expect(selected()).toBe("H1 2.25rem");
    const list = screen.getByRole("listbox", { name: "Variables" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(selected()).toBe("H2 1.75rem");
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

  it("is a value menu's chevron, never a ◇", () => {
    render(
      <VariableChoice
        leaf={FONT_SIZE}
        tokens={TOKENS}
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    const menu = trigger();
    expect(menu.textContent).toBe("");
    expect(menu.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(menu.querySelector(".lucide-diamond")).toBeNull();
    // Always drawn as it is: nothing marks it to be hidden until hover.
    expect(menu.className).toBe("nx-variable-menu");
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
        current={undefined}
        label="Font size"
        onPick={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});

/** The tooltip a control's keyboard focus opens, as the builder's tooltips do. */
async function tooltipOf(control: HTMLElement): Promise<string> {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => control.focus());
  const tips = await screen.findAllByRole("tooltip");
  return tips[0]?.textContent ?? "";
}

/** A spacing step named "XL", on a site with the engine's default prefix. */
const XL: SiteTokenSet = {
  tokens: [
    {
      name: "space.xl",
      label: "XL",
      kind: "dimension",
      values: { light: "64px" },
    },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
  ],
};

describe("the chip a held variable shows", () => {
  it("names the variable in green, with its value, and no ◇ or ✕", () => {
    render(
      <VariableChip
        leaf={FONT_SIZE}
        tokens={TOKENS}
        identity="font-size.display"
        label="Font size"
        onPick={vi.fn()}
        onUnlink={vi.fn()}
      />
    );
    const chip = screen.getByRole("group", { name: "Font size" });
    // A type size reads as its name and pair.
    expect(chip.textContent).toBe("Display · 48");
    // Green is the chip's class, which the stylesheet paints: see
    // variable-choice-styles.test.
    expect(chip.classList.contains("nx-variable-chip")).toBe(true);
    expect(chip.querySelector(".lucide-diamond, .lucide-x")).toBeNull();
    expect(
      within(chip).queryByRole("button", { name: "Clear Font size" })
    ).toBeNull();
  });

  it("says what the variable is in its tooltip: kind, name, value and CSS name", async () => {
    render(
      <VariableChip
        leaf={WIDTH}
        tokens={XL}
        identity="space.xl"
        label="Width"
        onPick={vi.fn()}
        onUnlink={vi.fn()}
      />
    );
    const name = screen.getByRole("button", {
      name: "Variables for Width: XL",
    });
    expect(await tooltipOf(name)).toBe(
      "Spacing variable XL · 64px · --site-space-xl"
    );
    // A tooltip, never a title.
    expect(screen.getByRole("group").getAttribute("title")).toBeNull();
    expect(name.getAttribute("title")).toBeNull();
  });

  it("names the CSS property with the site's own prefix", async () => {
    render(
      <VariableChip
        leaf={WIDTH}
        tokens={{ ...XL, prefix: "--acme-" }}
        identity="space.xl"
        label="Width"
        onPick={vi.fn()}
        onUnlink={vi.fn()}
      />
    );
    expect(
      await tooltipOf(
        screen.getByRole("button", { name: "Variables for Width: XL" })
      )
    ).toBe("Spacing variable XL · 64px · --acme-space-xl");
  });

  it("unlinks to the variable's value, once", () => {
    const onUnlink = vi.fn();
    render(
      <VariableChip
        leaf={WIDTH}
        tokens={XL}
        identity="space.xl"
        label="Width"
        onPick={vi.fn()}
        onUnlink={onUnlink}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlink Width" }));
    expect(onUnlink.mock.calls).toEqual([["64px"]]);
  });

  it("unlinks a scaled reference to the value it draws", () => {
    const onUnlink = vi.fn();
    render(
      <VariableChip
        leaf={WIDTH}
        tokens={XL}
        identity="space.xl"
        times={0.75}
        label="Width"
        onPick={vi.fn()}
        onUnlink={onUnlink}
      />
    );
    expect(screen.getByRole("group").textContent).toContain("XL × 0.75");
    fireEvent.click(screen.getByRole("button", { name: "Unlink Width" }));
    expect(onUnlink.mock.calls).toEqual([["48px"]]);
  });

  it("chooses another variable from its name", () => {
    const onPick = vi.fn();
    render(
      <VariableChip
        leaf={WIDTH}
        tokens={XL}
        identity="space.xl"
        label="Width"
        onPick={onPick}
        onUnlink={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Variables for Width: XL" })
    );
    expect(
      screen
        .getByRole("option", { name: "XL 64px" })
        .hasAttribute("data-current")
    ).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: "Sm 8px" }));
    expect(onPick).toHaveBeenCalledWith("space.sm");
  });

  it("shows the stored identity for a variable the site no longer has, with nothing to unlink to", () => {
    render(
      <VariableChip
        leaf={FONT_SIZE}
        tokens={TOKENS}
        identity="font-size.gone"
        label="Font size"
        onPick={vi.fn()}
        onUnlink={vi.fn()}
      />
    );
    const chip = screen.getByRole("group");
    expect(chip.textContent).toBe("font-size.gone");
    expect(within(chip).queryByRole("button", { name: /^Unlink/ })).toBeNull();
  });
});

describe("the value Unlink keeps", () => {
  const variable = (
    value: string,
    kind: SiteVariable["kind"] = "dimension"
  ): SiteVariable => ({
    identity: "v",
    name: "v",
    label: "V",
    kind,
    value,
    pair: { light: undefined, dark: undefined },
    swatch: undefined,
  });

  it.each([
    ["64px", undefined, "64px"],
    ["16px", 0.75, "12px"],
    ["1.5rem", 2, "3rem"],
    ["0.1rem", 3, "0.3rem"],
    ["clamp(1rem, 4vw, 3rem)", 0.5, "calc(clamp(1rem, 4vw, 3rem) * 0.5)"],
  ] as const)("keeps %s × %s as %s", (value, times, kept) => {
    expect(unlinkedValue(variable(value), times)).toBe(kept);
  });

  it("keeps a number variable as a number", () => {
    expect(unlinkedValue(variable("700", "number"))).toBe(700);
  });

  it("keeps a numeric weight as a number, and a weight keyword as written", () => {
    // A weight is stored as a number, its words as keywords: "700" written
    // as a string is a keyword no weight has, and the write would be refused.
    expect(unlinkedValue(variable("700", "fontWeight"))).toBe(700);
    expect(unlinkedValue(variable("bold", "fontWeight"))).toBe("bold");
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

  it("puts the whole value in the chip's tooltip, where the chip says Fluid", async () => {
    render(
      <VariableChip
        leaf={WIDTH}
        tokens={FLUID}
        identity="space.gutter-fluid"
        label="Width"
        onPick={vi.fn()}
        onUnlink={vi.fn()}
      />
    );
    const chip = screen.getByRole("group", { name: "Width" });
    expect(chip.textContent).toBe("Gutter fluid Fluid");
    expect(
      await tooltipOf(
        screen.getByRole("button", {
          name: "Variables for Width: Gutter fluid",
        })
      )
    ).toBe(
      "Spacing variable Gutter fluid · clamp(1rem, 4vw, 3rem) · --site-space-gutter-fluid"
    );
  });
});
