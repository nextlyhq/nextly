// @vitest-environment jsdom

/**
 * The inspector's Font control: a list of what the site can draw, and nothing
 * else. Variables first, then the families with files, then the system
 * families, with no box to type a family name into.
 */
import type {
  FontFaceDef,
  SiteTokenSet,
  StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  FontFamilyField,
  type FontFamilyFieldProps,
} from "./font-family-field";
import { InheritedValue } from "./inherited-value";

afterEach(cleanup);

beforeAll(() => {
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

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "font.heading",
      label: "Heading font",
      kind: "fontFamily",
      values: { light: "Georgia, serif" },
    },
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
  ],
};

const file = (id: string) => [{ url: `/api/media/${id}/raw`, format: "woff2" }];

const INTER: FontFaceDef = {
  family: "Inter",
  src: file("a"),
  weight: "100 900",
  source: { kind: "google", id: "inter", category: "sans-serif" },
};
const LORA: FontFaceDef = {
  family: "Lora",
  src: file("b"),
  weight: "400",
  source: { kind: "google", id: "lora", category: "serif" },
};

function mount(over: Partial<FontFamilyFieldProps> = {}, inherited?: string) {
  const onCommit = vi.fn<(value: StyleValue | null) => void>();
  render(
    <InheritedValue.Provider value={inherited}>
      <FontFamilyField
        stored={undefined}
        tokens={TOKENS}
        faces={[INTER, LORA]}
        fromCode={[]}
        onCommit={onCommit}
        {...over}
      />
    </InheritedValue.Provider>
  );
  return onCommit;
}

const trigger = (): HTMLElement =>
  screen.getByRole("button", { name: /^Font/ });

function open(): HTMLElement {
  fireEvent.click(trigger());
  return screen.getByRole("listbox");
}

/** The options of one group, by its heading. */
function optionsIn(list: HTMLElement, heading: string): string[] {
  const group = within(list).getByRole("group", { name: heading });
  return within(group)
    .getAllByRole("option")
    .map(option => option.textContent ?? "");
}

describe("FontFamilyField", () => {
  it("shows an inherited family greyed while none is chosen here", () => {
    // By its choice's name where the site offers it, and as written where
    // it does not; greyed as a placeholder, so it never reads as chosen.
    mount({}, "Lora");
    const value = trigger().querySelector(".nx-font-pick__value");
    expect(value?.textContent).toBe("Lora");
    expect(value?.hasAttribute("data-placeholder")).toBe(true);
    cleanup();
    mount({}, "Georgia, serif");
    expect(trigger().querySelector(".nx-font-pick__value")?.textContent).toBe(
      "Georgia, serif"
    );
  });

  it("shows the family chosen here over an inherited one", () => {
    mount({ stored: "Inter" }, "Lora");
    const value = trigger().querySelector(".nx-font-pick__value");
    expect(value?.textContent).toBe("Inter");
    expect(value?.hasAttribute("data-placeholder")).toBe(false);
  });

  it("offers the site's variables, then its families, then the system's, and nothing to type", () => {
    mount();
    const list = open();
    const headings = within(list)
      .getAllByRole("group")
      .map(group => group.getAttribute("aria-label"));
    expect(headings).toEqual(["Font variables", "On this site", "System"]);
    expect(optionsIn(list, "Font variables")).toContain("Heading font");
    expect(optionsIn(list, "On this site")).toEqual(["Inter", "Lora"]);
    // Every generic family the engine accepts, the common ones first.
    expect(optionsIn(list, "System")).toEqual([
      "System UI",
      "Sans serif",
      "Serif",
      "Monospace",
      "Cursive",
      "Fantasy",
      "System sans serif",
      "System serif",
      "System monospace",
      "System rounded",
      "Math",
      "Emoji",
      "Fangsong",
    ]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("draws each family in itself", () => {
    mount();
    const list = open();
    const inter = within(list).getByRole("option", { name: "Inter" });
    expect(inter.style.fontFamily).toContain("Inter");
    // A long name is cut with an ellipsis, so it is whole on hover.
    expect(inter.getAttribute("title")).toBe("Inter");
  });

  it("stores a variable as a reference to it", () => {
    const onCommit = mount();
    fireEvent.click(
      within(open()).getByRole("option", { name: "Heading font" })
    );
    expect(onCommit).toHaveBeenCalledWith({ $token: "font.heading" });
  });

  it("stores a site family with the generic family of its category after it", () => {
    const onCommit = mount();
    fireEvent.click(within(open()).getByRole("option", { name: "Lora" }));
    expect(onCommit).toHaveBeenCalledWith('"Lora", serif');
  });

  it("names the current choice on the control, drawn in itself", () => {
    mount({ stored: { $token: "font.heading" } });
    expect(trigger().getAttribute("aria-label")).toBe("Font, Heading font");
    mount({ stored: '"Inter", sans-serif' });
    expect(screen.getAllByRole("button", { name: "Font, Inter" })).toHaveLength(
      1
    );
  });

  it("shows a value that is none of these, with no Clear of its own", () => {
    // The row's reset removes a stored family, so a Clear here was a second
    // way to do one thing on the same row.
    mount({ stored: "Comic Sans MS, cursive" });
    expect(
      screen.getByText("Comic Sans MS, cursive · not on this site")
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Clear Font" })).toBeNull();
  });

  it("sends the author to Design's fonts to add or manage one", () => {
    const onManageFonts = vi.fn();
    mount({ onManageFonts });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Manage fonts…" }));
    expect(onManageFonts).toHaveBeenCalledTimes(1);
  });

  it("offers no way to manage fonts where the host has none", () => {
    mount();
    open();
    expect(screen.queryByRole("button", { name: "Manage fonts…" })).toBeNull();
  });

  it("moves through the options with the arrow keys, picks with Enter and closes with Escape", async () => {
    const onCommit = mount();
    open();
    // The list is long enough to offer its search, which carries the keys.
    const list = screen.getByRole("combobox");
    const first = list.getAttribute("aria-activedescendant");
    expect(first).not.toBeNull();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    const second = list.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(
      document.getElementById(second ?? "")?.getAttribute("aria-selected")
    ).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(list.getAttribute("aria-activedescendant")).toBe(first);
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("fangsong");

    open();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    // The popover hands focus back once it has unmounted, a tick later.
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("offers a search only once the list is long", () => {
    const many = ["A", "B", "C", "D", "E"].map(
      (family, index): FontFaceDef => ({
        family: `Face ${family}`,
        src: file(String(index)),
      })
    );
    mount({ faces: [INTER, LORA, ...many] });
    open();
    const search = screen.getByRole("combobox", { name: "Search fonts" });
    fireEvent.change(search, { target: { value: "face c" } });
    const list = screen.getByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map(o => o.textContent)
    ).toEqual(["Face C"]);
  });
});

describe("a font variable chosen", () => {
  it("shows in green, says what it is in the trigger's tooltip, and unlinks to its family", async () => {
    const onCommit = mount({ stored: { $token: "font.heading" } });
    const pick = document.querySelector(".nx-font-pick") as HTMLElement;
    // Green is the stylesheet's, for this mark: see variable-choice-styles.test.
    expect(pick.hasAttribute("data-bound")).toBe(true);
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => trigger().focus());
    expect((await screen.findAllByRole("tooltip"))[0]?.textContent).toBe(
      "Font variable Heading font · Georgia, serif · --site-font-heading"
    );
    fireEvent.click(screen.getByRole("button", { name: "Unlink Font" }));
    // One commit, the family as a plain value.
    expect(onCommit.mock.calls).toEqual([["Georgia, serif"]]);
  });

  it("keeps focus on the Font control once Unlink has made the family plain", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <FontFamilyField
        stored={{ $token: "font.heading" }}
        tokens={TOKENS}
        faces={[INTER, LORA]}
        fromCode={[]}
        onCommit={onCommit}
      />
    );
    const unlink = screen.getByRole("button", { name: "Unlink Font" });
    act(() => unlink.focus());
    fireEvent.click(unlink);
    // The document answers with the plain family, and Unlink is gone.
    rerender(
      <FontFamilyField
        stored="Georgia, serif"
        tokens={TOKENS}
        faces={[INTER, LORA]}
        fromCode={[]}
        onCommit={onCommit}
      />
    );
    expect(screen.queryByRole("button", { name: "Unlink Font" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("is described by its tooltip as well as by its label while the tooltip shows", async () => {
    mount({ stored: { $token: "font.heading" }, labelledBy: "font-label" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => trigger().focus());
    const tip = (await screen.findAllByRole("tooltip"))[0];
    const described = trigger().getAttribute("aria-describedby") ?? "";
    expect(described.split(" ")).toContain("font-label");
    expect(described.split(" ")).toContain(tip?.id);
  });

  it("is not green and offers no Unlink for a family chosen as itself", () => {
    mount({ stored: '"Inter", sans-serif' });
    const pick = document.querySelector(".nx-font-pick") as HTMLElement;
    expect(pick.hasAttribute("data-bound")).toBe(false);
    expect(screen.queryByRole("button", { name: "Unlink Font" })).toBeNull();
  });
});
