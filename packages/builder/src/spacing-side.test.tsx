// @vitest-environment jsdom

/**
 * A spacing-box side as a button, and the popover it opens: its contents for
 * a top and a left side, quick entry round the box, the popover's keys,
 * "Apply to" in one edit, a variable's green, and the three ways to reset.
 *
 * @module spacing-side.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
  type SiteTokenSet,
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

import type { EditorState } from "./editor-state";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(() => {
  cleanup();
  clearBlocks();
});

beforeAll(() => {
  // Radix measures and scrolls; jsdom provides neither.
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const LTR = { writingMode: "horizontal-tb", direction: "ltr" } as const;

const TOKENS: SiteTokenSet = {
  tokens: [
    { name: "space.xl", kind: "dimension", values: { light: "64px" } },
    { name: "space.sm", kind: "dimension", values: { light: "8px" } },
    { name: "space.md", kind: "dimension", values: { light: "16px" } },
    { name: "radius.pill", kind: "dimension", values: { light: "12px" } },
  ],
};

type Editor = EditorState & { applyAll: ReturnType<typeof vi.fn> };

function mount(styles?: NodeStyles, tokens: SiteTokenSet = TOKENS): Editor {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: { text: { type: "text" } },
        supports: { spacing: true },
        render: () => null,
      },
    ] as never,
    { source: "spacing-side-test" }
  );
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "acme/box",
        version: 1,
        props: {},
        ...(styles === undefined ? {} : { styles }),
      },
    ] as BlockNode[],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as Editor;
  render(
    <StyleInspectorPanel editor={editor} tokens={tokens} sideOrientation={LTR} />
  );
  return editor;
}

const at = (values: Record<string, unknown>): NodeStyles =>
  ({ base: { [BASE_BREAKPOINT]: values } }) as unknown as NodeStyles;

function box(): HTMLElement {
  return document.querySelector(".nx-spacing-box") as HTMLElement;
}

/** A side's button, by its name: "Margin top". */
function side(name: string): HTMLButtonElement {
  return within(box()).getByRole("button", {
    name: new RegExp(`^${name} `),
  }) as HTMLButtonElement;
}

/** What one write set, as the op carries it. */
function written(editor: Editor, call = 0): string {
  return JSON.stringify(editor.applyAll.mock.calls[call]?.[0]);
}

function radios(group: string): string[] {
  return within(screen.getByRole("radiogroup", { name: group }))
    .getAllByRole("radio")
    .map(radio => radio.textContent ?? "");
}

describe("a spacing-box side", () => {
  it("is a button showing its value whole, or – while unset, with no ◇ or unit menu", () => {
    mount(at({ padding: { blockStart: "10px" } }));
    const top = side("Padding top");
    expect(top.textContent).toBe("10px");
    // The whole value is in its name too, for a value cut short on screen.
    expect(top).toHaveProperty("tagName", "BUTTON");
    expect(screen.getByRole("button", { name: "Padding top 10px" })).toBe(top);
    expect(side("Padding bottom").textContent).toBe("–");
    expect(box().querySelector(".nx-variable-choice")).toBeNull();
    expect(box().querySelector(".nx-style-inspector__unit")).toBeNull();
    expect(box().textContent).not.toContain("◇");
  });

  it("names a value its cell cuts short in its tooltip", async () => {
    mount(at({ padding: { inlineStart: "12.375rem" } }));
    const left = side("Padding left");
    const text = left.querySelector(".nx-spacing-side__text") as HTMLElement;
    Object.defineProperty(text, "scrollWidth", { value: 80 });
    Object.defineProperty(text, "clientWidth", { value: 40 });
    fireEvent.pointerEnter(left);
    fireEvent.focus(left);
    expect(
      (await screen.findAllByRole("tooltip")).some(
        tip => tip.textContent === "12.375rem"
      )
    ).toBe(true);
  });

  it("opens a popover titled with a top side: presets, a number with its unit, and Apply to", () => {
    mount();
    fireEvent.click(side("Padding top"));
    const popover = screen.getByRole("dialog", { name: "Padding top" });
    // "None" first, then the site's spacing variables smallest first; a
    // radius is not a spacing preset.
    const presets = radios("Presets");
    expect(presets.slice(0, 2)).toEqual(["None 0", "Sm 8px"]);
    // Smallest first; a radius is not a spacing preset.
    expect(presets.indexOf("Md 16px")).toBeLessThan(presets.indexOf("Xl 64px"));
    expect(presets.some(preset => preset.startsWith("Pill"))).toBe(false);
    expect(within(popover).getByLabelText("Value for Padding top")).toBeDefined();
    expect(within(popover).getByLabelText("Unit for Padding top")).toBeDefined();
    expect(radios("Apply to")).toEqual([
      "This side",
      "Top & bottom",
      "All sides",
    ]);
    // Opened by a click, focus starts on the presets.
    expect(document.activeElement?.getAttribute("role")).toBe("radio");
  });

  it("closes when its side is pressed again", () => {
    mount();
    const top = side("Padding top");
    fireEvent.click(top);
    screen.getByRole("dialog", { name: "Padding top" });
    fireEvent.pointerDown(top);
    fireEvent.click(top);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a refused value in the popover on Enter, and says why", () => {
    const editor = mount();
    fireEvent.click(side("Padding top"));
    const number = screen.getByLabelText(
      "Value for Padding top"
    ) as HTMLInputElement;
    number.focus();
    fireEvent.change(number, { target: { value: "red" } });
    fireEvent.keyDown(number, { key: "Enter" });
    // Nothing written, the popover still open on the draft, and the refusal
    // said where it was typed.
    expect(editor.applyAll).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Padding top" });
    expect(number.value).toBe("red");
    expect(within(dialog).getByRole("alert").textContent).not.toBe("");
    expect(number.getAttribute("aria-invalid")).toBe("true");
  });

  it("still closes on Escape over a refused value, back on its side", () => {
    mount();
    fireEvent.click(side("Padding top"));
    const number = screen.getByLabelText("Value for Padding top");
    fireEvent.change(number, { target: { value: "red" } });
    fireEvent.keyDown(number, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(side("Padding top"));
  });

  it("lets Tab leave past its last control after a refused value was left behind", () => {
    // A refusal the author has moved on from holds nothing open: Tab past
    // the last control still goes on to the next side.
    mount();
    fireEvent.click(side("Padding top"));
    const number = screen.getByLabelText("Value for Padding top");
    fireEvent.change(number, { target: { value: "red" } });
    // Tab out of the number moves on natively, and its blur is refused.
    fireEvent.blur(number);
    const last = screen.getByRole("radio", { name: "This side" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(side("Padding right"));
  });

  it("keeps a refused value in quick entry on Tab, and doesn't move on", () => {
    const editor = mount();
    const top = side("Margin top");
    top.focus();
    fireEvent.keyDown(top, { key: "4" });
    const number = screen.getByLabelText(
      "Value for Margin top"
    ) as HTMLInputElement;
    fireEvent.change(number, { target: { value: "4qq" } });
    fireEvent.keyDown(number, { key: "Tab" });
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Margin top" })).toBeDefined();
    expect(document.activeElement).toBe(number);
  });

  it("opens with focus inside it for a side holding a variable it doesn't offer as a preset", () => {
    // A radius bound to a margin: no preset is marked, so the first keeps
    // the group's Tab stop and takes focus.
    mount(at({ margin: { blockStart: { $token: "radius.pill" } } }));
    fireEvent.click(side("Margin top"));
    const dialog = screen.getByRole("dialog", { name: "Margin top" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("None 0");
  });

  it("keeps None apart from a spacing variable whose id is \"none\"", () => {
    const editor = mount(undefined, {
      tokens: [
        {
          id: "none",
          name: "space.small",
          kind: "dimension",
          values: { light: "8px" },
        },
      ],
    } as SiteTokenSet);
    fireEvent.click(side("Padding top"));
    const presets = radios("Presets");
    expect(presets[0]).toBe("None 0");
    expect(presets).toContain("Small 8px");
    fireEvent.click(screen.getByRole("radio", { name: "Small 8px" }));
    expect(written(editor)).toContain('"blockStart":{"$token":"none"}');
  });

  it("tells apart two spacing presets that share a name", () => {
    mount(undefined, {
      tokens: [
        {
          name: "space.card",
          label: "Card",
          kind: "dimension",
          values: { light: "8px" },
        },
        {
          name: "spacing.card",
          label: "Card",
          kind: "dimension",
          values: { light: "8px" },
        },
      ],
    } as SiteTokenSet);
    fireEvent.click(side("Padding top"));
    const presets = radios("Presets");
    expect(presets).toContain("Card (space.card) 8px");
    expect(presets).toContain("Card (spacing.card) 8px");
  });

  it("offers Left & right for a left side", () => {
    mount();
    fireEvent.click(side("Margin left"));
    screen.getByRole("dialog", { name: "Margin left" });
    expect(radios("Apply to")).toEqual(["This side", "Left & right", "All sides"]);
  });

  it("writes a preset to the top and bottom as one edit, as a variable", () => {
    const editor = mount();
    fireEvent.click(side("Padding top"));
    fireEvent.click(screen.getByRole("radio", { name: "Top & bottom" }));
    fireEvent.click(screen.getByRole("radio", { name: "Xl 64px" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    const op = written(editor);
    expect(op).toContain('"blockStart":{"$token":"space.xl"}');
    expect(op).toContain('"blockEnd":{"$token":"space.xl"}');
    expect(op).not.toContain("inlineStart");
  });

  it("writes None as a zero, and a typed number as a literal", () => {
    const editor = mount();
    fireEvent.click(side("Padding top"));
    fireEvent.click(screen.getByRole("radio", { name: "None 0" }));
    expect(written(editor, 0)).toContain('"blockStart":"0"');
    const number = screen.getByLabelText("Value for Padding top");
    // Typed in, as an author types: focus is in the number when Enter goes.
    number.focus();
    fireEvent.change(number, { target: { value: "24" } });
    fireEvent.keyDown(number, { key: "Enter" });
    expect(written(editor, 1)).toContain('"blockStart":"24px"');
    // Enter writes once and closes: no second commit of the same value, which
    // the editor, not yet drawn, would take from the page as it was.
    expect(editor.applyAll).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sets each side by typing round the box: 4 0 Tab, four times", () => {
    const editor = mount();
    const order = ["Margin top", "Margin right", "Margin bottom", "Margin left"];
    side("Margin top").focus();
    for (const [index] of order.entries()) {
      const at = document.activeElement as HTMLElement;
      expect(at.getAttribute("aria-labelledby")).toBeTruthy();
      fireEvent.keyDown(at, { key: "4" });
      const number = screen.getByRole("textbox", {
        name: `Value for ${order[index] ?? ""}`,
      });
      // Quick entry: the digit is in the number, and focus with it.
      expect((number as HTMLInputElement).value).toBe("4");
      expect(document.activeElement).toBe(number);
      fireEvent.change(number, { target: { value: "40" } });
      fireEvent.keyDown(number, { key: "Tab" });
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    // Margin, then padding: the fifth stop is the padding's top.
    expect(document.activeElement).toBe(side("Padding top"));
    const sides = ["blockStart", "inlineEnd", "blockEnd", "inlineStart"];
    sides.forEach((name, call) => {
      expect(written(editor, call)).toContain(`"${name}":"40px"`);
    });
  });

  it("closes on Tab past its last control and moves on, and Escape returns to the side", () => {
    mount();
    fireEvent.click(side("Padding top"));
    const last = screen.getByRole("radio", { name: "This side" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(side("Padding right"));

    fireEvent.click(side("Padding right"));
    const dialog = screen.getByRole("dialog", { name: "Padding right" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(side("Padding right"));
  });

  it("shows a variable's value green and named, and says what green means", () => {
    mount(at({ padding: { blockStart: { $token: "space.xl" } } }));
    const top = side("Padding top");
    expect(top.textContent).toBe("Xl");
    expect(top.hasAttribute("data-bound")).toBe(true);
    expect(box().textContent).toContain(
      "Green values come from your spacing variables."
    );
  });

  it("says nothing of green while no side holds a variable", () => {
    mount(at({ padding: { blockStart: "8px" } }));
    expect(box().textContent).not.toContain("Green values");
  });

  it("resets from the popover's menu", () => {
    const editor = mount(at({ margin: { blockStart: "8px" } }));
    fireEvent.click(side("Margin top"));
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Margin top" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).not.toContain("8px");
  });

  it("resets from the side's context menu", () => {
    const editor = mount(at({ margin: { blockStart: "8px" } }));
    fireEvent.contextMenu(side("Margin top"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset" }));
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).not.toContain("8px");
  });

  it("resets a side holding a variable with Alt+Backspace", () => {
    const editor = mount(at({ margin: { blockStart: { $token: "space.sm" } } }));
    fireEvent.keyDown(side("Margin top"), { key: "Backspace", altKey: true });
    expect(editor.applyAll).toHaveBeenCalledTimes(1);
    expect(written(editor)).not.toContain("space.sm");
  });

  it("does not reset the side from a key pressed in its popover", () => {
    const editor = mount(at({ margin: { blockStart: "8px" } }));
    fireEvent.click(side("Margin top"));
    const number = screen.getByLabelText("Value for Margin top");
    act(() => {
      fireEvent.keyDown(number, { key: "Backspace", altKey: true });
    });
    expect(editor.applyAll).not.toHaveBeenCalled();
  });
});
