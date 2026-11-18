// @vitest-environment jsdom

/**
 * Design → Type → "Text styles", driven as an author drives it: the rows and
 * their previews, "+ Add text style", rename in place, the ⋯ menu's copy,
 * lock and removal, each part of a style, and the section read-only.
 *
 * @module text-styles-section.test
 */
import {
  BASE_BREAKPOINT,
  fluidValue,
  type BreakpointSet,
  type NamedClass,
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
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClassListEdit } from "./block-style-actions";
import type { SharedStyleChange } from "./shared-style-target";
import type {
  PageClassBlocks,
  SharedStylesAccess,
} from "./shared-styles-types";
import { TextStylesSection } from "./text-styles-section";

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

const eyebrow: NamedClass = {
  id: "t-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 1,
  role: "text",
  styles: {
    base: {
      [BASE_BREAKPOINT]: {
        fontSize: "12px",
        lineHeight: 1.4,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      },
    },
  } as NodeStyles,
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: {},
};
const breakpoints = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
} as unknown as BreakpointSet;

/** The section over a library, with a host that records every write. */
function mount(
  options: {
    library?: NamedClass[];
    tokens?: SiteTokenSet;
    pageBlocks?: PageClassBlocks;
    readOnly?: boolean;
    access?: Partial<SharedStylesAccess>;
  } = {}
) {
  let library: readonly NamedClass[] = options.library ?? [card, eyebrow];
  const edit = vi.fn(async (compose: ClassListEdit) => {
    const answer = compose(library);
    if ("reason" in answer) return answer.reason;
    library = answer.classes;
    return undefined;
  });
  const writeStyles = vi.fn(
    async (_id: string, _change: SharedStyleChange) =>
      undefined as string | undefined
  );
  const access = {
    usage: vi.fn(),
    uses: vi.fn(),
    lock: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    ...options.access,
  } as unknown as SharedStylesAccess;
  const view = render(
    <TextStylesSection
      library={library}
      tokens={options.tokens ?? { tokens: [] }}
      pageBlocks={options.pageBlocks ?? { counts: new Map(), complete: true }}
      mode="light"
      breakpoints={breakpoints}
      readOnly={options.readOnly ?? false}
      onEditClasses={edit}
      host={{ mayChange: !(options.readOnly ?? false), writeStyles }}
      access={access}
    />
  );
  return { edit, writeStyles, access, stored: () => library, view };
}

/** What a part's change writes over the styles given. */
function written(
  writeStyles: ReturnType<typeof vi.fn>,
  over: NodeStyles = eyebrow.styles
): NodeStyles | undefined {
  const change = writeStyles.mock.lastCall?.[1] as SharedStyleChange;
  const out = change(over);
  return out.kind === "write" ? out.styles : undefined;
}

const row = (name: RegExp) => screen.getByRole("button", { name });

describe("the rows", () => {
  it("list the text styles only, each with a preview and its size", () => {
    mount();
    const eyebrowRow = row(/^Text styles: Eyebrow, 12 \/ 1\.4/);
    const sample = within(eyebrowRow).getByText("The quick survey");
    expect(sample.style.textTransform).toBe("uppercase");
    expect(screen.queryByRole("button", { name: /Card/ })).toBeNull();
  });

  it("say there are none yet on a site with none", () => {
    mount({ library: [card] });
    expect(screen.getByText(/No text styles yet/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "+ Add text style" })
    ).toBeDefined();
  });
});

describe("+ Add text style", () => {
  it("makes a text style with the name typed", async () => {
    const { stored } = mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add text style" }));
    const field = screen.getByRole("textbox", { name: "New text style name" });
    fireEvent.change(field, { target: { value: "Display" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(stored().at(-1)).toMatchObject({
      label: "Display",
      slug: "display",
      role: "text",
    });
  });

  it("says why a name is refused, and keeps the field open", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add text style" }));
    const field = screen.getByRole("textbox", { name: "New text style name" });
    fireEvent.change(field, { target: { value: "eyebrow" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /already a text style named/
    );
  });
});

describe("a row's keys and menu", () => {
  it("renames in place with F2, and Escape puts the field down", async () => {
    const { stored } = mount();
    fireEvent.keyDown(row(/^Text styles: Eyebrow/), { key: "F2" });
    const field = screen.getByRole("textbox", { name: "Rename Eyebrow" });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "Rename Eyebrow" })
    ).toBeNull();

    fireEvent.keyDown(row(/^Text styles: Eyebrow/), { key: "F2" });
    const again = screen.getByRole("textbox", { name: "Rename Eyebrow" });
    fireEvent.change(again, { target: { value: "Kicker" } });
    await act(async () => {
      fireEvent.keyDown(again, { key: "Enter" });
    });
    expect(stored().find(entry => entry.id === "t-eyebrow")?.label).toBe(
      "Kicker"
    );
  });

  /** Open a row's ⋯ menu from the row, with Shift+F10. */
  const menuOf = (): HTMLElement => {
    fireEvent.keyDown(row(/^Text styles: Eyebrow/), {
      key: "F10",
      shiftKey: true,
    });
    return screen.getByRole("menu");
  };

  it("duplicates from the ⋯ menu, opened with Shift+F10", async () => {
    const { stored } = mount();
    const menu = menuOf();
    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "Duplicate" })
      );
    });
    expect(stored().at(-1)).toMatchObject({
      label: "Eyebrow copy",
      role: "text",
    });
  });

  it("locks and removes through the shared styles' routes", async () => {
    const { access } = mount();
    const menu = menuOf();
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Lock" }));
    });
    expect(access.lock).toHaveBeenCalledWith("t-eyebrow", true);
    cleanup();
    const second = mount();
    const again = menuOf();
    await act(async () => {
      fireEvent.click(within(again).getByRole("menuitem", { name: "Remove" }));
    });
    expect(second.access.remove).toHaveBeenCalledWith(["t-eyebrow"]);
  });

  it("refuses removing a text style a block on the open page wears, before asking the site", async () => {
    for (const pageBlocks of [
      { counts: new Map([["t-eyebrow", 1]]), complete: true },
      // A page read only in part may hold one: unknown reads as used.
      { counts: new Map<string, number>(), complete: false },
    ]) {
      const { access } = mount({ pageBlocks });
      const menu = menuOf();
      await act(async () => {
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove" }));
      });
      expect(access.remove).not.toHaveBeenCalled();
      expect(
        await screen.findByText(
          "Used on this page, so it can’t be removed. Take it off the blocks that use it first."
        )
      ).toBeDefined();
      cleanup();
    }
  });

  it("says where a text style is used when its removal is refused", async () => {
    const words = "Eyebrow is used: Heading 1 uses it, and 2 blocks on Home.";
    mount({ access: { remove: vi.fn(async () => words) } });
    fireEvent.keyDown(row(/^Text styles: Eyebrow/), {
      key: "F10",
      shiftKey: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(words);
  });

  it("offers a locked one Unlock, and neither Rename nor Remove", () => {
    mount({ library: [{ ...eyebrow, locked: true }] });
    fireEvent.keyDown(row(/^Text styles: Eyebrow, .*locked/), {
      key: "F10",
      shiftKey: true,
    });
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent)
    ).toEqual(["Duplicate", "Unlock"]);
  });
});

describe("a text style's parts", () => {
  const openParts = () => fireEvent.click(row(/^Text styles: Eyebrow/));

  it("sets its case", () => {
    const { writeStyles } = mount();
    openParts();
    fireEvent.click(screen.getByRole("radio", { name: "Capitalised" }));
    expect(writeStyles.mock.lastCall?.[0]).toBe("t-eyebrow");
    expect(written(writeStyles)?.base?.[BASE_BREAKPOINT]).toMatchObject({
      textTransform: "capitalize",
    });
    expect(screen.getByRole("radio", { name: "As typed" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "UPPERCASE" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "lowercase" })).toBeDefined();
  });

  it("takes letter spacing in em unless another unit is typed", () => {
    const { writeStyles } = mount();
    openParts();
    const field = screen.getByRole("textbox", { name: "Letter spacing" });
    expect((field as HTMLInputElement).value).toBe("0.08");
    fireEvent.change(field, { target: { value: "0.1" } });
    fireEvent.blur(field);
    expect(written(writeStyles)?.base?.[BASE_BREAKPOINT]).toMatchObject({
      letterSpacing: "0.1em",
    });
  });

  it("sets a size for each device, Desktop, Tablet and Mobile", () => {
    const { writeStyles } = mount();
    openParts();
    const mobile = screen.getByRole("textbox", { name: "Size on Mobile" });
    expect(
      screen.getByRole("textbox", { name: "Size on Desktop" })
    ).toBeDefined();
    expect(
      screen.getByRole("textbox", { name: "Size on Tablet" })
    ).toBeDefined();
    fireEvent.change(mobile, { target: { value: "10px" } });
    fireEvent.blur(mobile);
    expect(written(writeStyles)?.base?.mobile).toMatchObject({
      fontSize: "10px",
    });
  });
});

describe("a device's own size", () => {
  const withMobile: NamedClass = {
    ...eyebrow,
    styles: {
      base: {
        ...eyebrow.styles.base,
        mobile: { fontSize: "10px" },
      },
    } as NodeStyles,
  };

  it("is reset, so the device follows Desktop's size again", () => {
    const { writeStyles } = mount({ library: [withMobile] });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    fireEvent.click(
      screen.getByRole("button", { name: "Reset the size on Mobile" })
    );
    const after = written(writeStyles, withMobile.styles);
    expect(after?.base?.mobile?.fontSize).toBeUndefined();
    expect(after?.base?.[BASE_BREAKPOINT]).toMatchObject({ fontSize: "12px" });
  });

  it("offers no Reset where a device holds no size of its own, nor on Desktop", () => {
    mount({ library: [withMobile] });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    expect(
      screen.queryByRole("button", { name: "Reset the size on Tablet" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset the size on Desktop" })
    ).toBeNull();
  });
});

describe("a part's own value", () => {
  it("is reset, so the style writes none, for letter spacing, line height and weight", () => {
    for (const [label, property] of [
      ["Letter spacing", "letterSpacing"],
      ["Line height", "lineHeight"],
      ["Weight", "fontWeight"],
    ] as const) {
      const { writeStyles } = mount();
      fireEvent.click(row(/^Text styles: Eyebrow/));
      fireEvent.click(screen.getByRole("button", { name: `Reset ${label}` }));
      const after = written(writeStyles)?.base?.[BASE_BREAKPOINT] as
        | Record<string, unknown>
        | undefined;
      expect(after, label).not.toHaveProperty(property);
      expect(after).toHaveProperty("fontSize", "12px");
      cleanup();
    }
  });

  it("says Weight is not set on a style that sets none, so Regular 400 can be picked", async () => {
    const unweighted: NamedClass = {
      ...eyebrow,
      styles: {
        base: { [BASE_BREAKPOINT]: { fontSize: "12px" } },
      } as NodeStyles,
    };
    const { writeStyles } = mount({ library: [card, unweighted] });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    const trigger = screen.getByRole("combobox", { name: /^Weight, / });
    // Not Regular 400: that would read as already chosen, so choosing it
    // could never write the weight a heading needs to stop being bold.
    expect(trigger.getAttribute("aria-label")).toBe("Weight, Not set");
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Regular 400" }));
    expect(
      written(writeStyles, unweighted.styles)?.base?.[BASE_BREAKPOINT]
    ).toMatchObject({
      fontWeight: 400,
    });
  });

  it("keeps a variable's multiplier when the part is unlinked", () => {
    const halved: NamedClass = {
      ...eyebrow,
      styles: {
        base: {
          [BASE_BREAKPOINT]: {
            fontSize: { $token: "font-size.display", times: 0.5 },
          },
        },
      } as unknown as NodeStyles,
    };
    const { writeStyles } = mount({
      library: [card, halved],
      tokens: {
        tokens: [
          {
            name: "font-size.display",
            kind: "dimension",
            values: { light: "32px" },
          },
        ],
      },
    });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    const unlink = screen
      .getAllByRole("button")
      .filter(button =>
        /^Unlink /.test(button.getAttribute("aria-label") ?? "")
      );
    expect(unlink.map(button => button.getAttribute("aria-label"))).toEqual([
      "Unlink Desktop",
    ]);
    fireEvent.click(unlink[0] as HTMLElement);
    // What the page drew (half of 32px), not the variable's own value.
    expect(
      written(writeStyles, halved.styles)?.base?.[BASE_BREAKPOINT]
    ).toMatchObject({
      fontSize: "16px",
    });
  });

  it("says Font is not set on a style that sets none, so Body font can be picked", async () => {
    const { writeStyles } = mount();
    fireEvent.click(row(/^Text styles: Eyebrow/));
    const trigger = screen.getByRole("combobox", { name: /^Font, / });
    expect(trigger.getAttribute("aria-label")).toBe("Font, Not set");
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: "Body font" }));
    expect(written(writeStyles)?.base?.[BASE_BREAKPOINT]).toMatchObject({
      fontFamily: { $token: "font.body" },
    });
  });

  it("checks no case on a style that sets none, so As typed can be picked", () => {
    const uncased: NamedClass = {
      ...eyebrow,
      styles: {
        base: { [BASE_BREAKPOINT]: { fontSize: "12px" } },
      } as NodeStyles,
    };
    const { writeStyles } = mount({ library: [card, uncased] });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    const typed = screen.getByRole("radio", {
      name: "As typed",
    }) as HTMLInputElement;
    expect(typed.checked).toBe(false);
    fireEvent.click(typed);
    expect(
      written(writeStyles, uncased.styles)?.base?.[BASE_BREAKPOINT]
    ).toMatchObject({
      textTransform: "none",
    });
  });

  it("shows a variable a line height or weight holds, and unlinks it", () => {
    const linked: NamedClass = {
      ...eyebrow,
      styles: {
        base: {
          [BASE_BREAKPOINT]: {
            fontSize: "12px",
            lineHeight: { $token: "leading.tight" },
            fontWeight: { $token: "weight.bold" },
          },
        },
      } as unknown as NodeStyles,
    };
    const { writeStyles } = mount({
      library: [card, linked],
      tokens: {
        tokens: [
          { name: "leading.tight", kind: "number", values: { light: "1.2" } },
          { name: "weight.bold", kind: "fontWeight", values: { light: "700" } },
        ],
      },
    });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    fireEvent.click(screen.getByRole("button", { name: "Unlink Line height" }));
    expect(
      written(writeStyles, linked.styles)?.base?.[BASE_BREAKPOINT]
    ).toMatchObject({
      lineHeight: 1.2,
    });
    expect(screen.getByRole("button", { name: "Unlink Weight" })).toBeDefined();
  });

  it("offers no Reset for a part the style leaves unset", () => {
    mount({
      library: [
        {
          ...eyebrow,
          styles: { base: { [BASE_BREAKPOINT]: { fontSize: "12px" } } },
        },
      ],
    });
    fireEvent.click(row(/^Text styles: Eyebrow/));
    expect(
      screen.queryByRole("button", { name: "Reset Letter spacing" })
    ).toBeNull();
  });
});

describe("read-only", () => {
  it("offers no add, no menu and no changes to a role that may not change design", () => {
    const { writeStyles } = mount({ readOnly: true });
    expect(
      screen.queryByRole("button", { name: "+ Add text style" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^More actions for/ })
    ).toBeNull();
    fireEvent.keyDown(row(/^Text styles: Eyebrow/), { key: "F2" });
    expect(
      screen.queryByRole("textbox", { name: "Rename Eyebrow" })
    ).toBeNull();
    fireEvent.click(row(/^Text styles: Eyebrow/));
    expect(
      screen.getByText("You can't change this site's design.")
    ).toBeDefined();
    const caps = screen.getByRole("radio", { name: "Capitalised" });
    expect((caps as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(caps);
    expect(writeStyles).not.toHaveBeenCalled();
  });
});

describe("a size made fluid", () => {
  const range = { min: 360, max: 1280 };
  const openParts = () => fireEvent.click(row(/^Text styles: Eyebrow/));
  /** "Fluid…" beside Desktop's size, the first device listed. */
  const openFluid = () =>
    fireEvent.click(screen.getAllByRole("button", { name: "Fluid…" })[0]!);

  it("stores the size and the two sizes it was made from, in one edit", async () => {
    const { edit, writeStyles, stored } = mount();
    openParts();
    openFluid();
    fireEvent.change(screen.getByLabelText("On small screens"), {
      target: { value: "16" },
    });
    fireEvent.change(screen.getByLabelText("On large screens"), {
      target: { value: "32" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make fluid" }));
    });
    expect(edit).toHaveBeenCalledTimes(1);
    expect(writeStyles).not.toHaveBeenCalled();
    const style = stored().find(entry => entry.id === "t-eyebrow");
    expect(style?.styles.base?.[BASE_BREAKPOINT]).toMatchObject({
      fontSize: fluidValue({ small: 16, large: 32 }, range),
      lineHeight: 1.4,
    });
    expect(style?.fluidSizes).toEqual({
      [BASE_BREAKPOINT]: { small: 16, large: 32 },
    });
    // The rest of the library is as it was.
    expect(stored().find(entry => entry.id === "c-card")).toBe(card);
  });

  it("opens on the sizes a fluid size was made from", () => {
    const sizes = { small: 15.5, large: 31.5 };
    const fluid: NamedClass = {
      ...eyebrow,
      styles: {
        base: { [BASE_BREAKPOINT]: { fontSize: fluidValue(sizes, range) } },
      } as NodeStyles,
      fluidSizes: { [BASE_BREAKPOINT]: sizes },
    };
    mount({ library: [fluid] });
    openParts();
    openFluid();
    expect(
      (screen.getByLabelText("On small screens") as HTMLInputElement).value
    ).toBe("15.5");
    expect(
      (screen.getByLabelText("On large screens") as HTMLInputElement).value
    ).toBe("31.5");
  });

  it("opens on the size as it reads where it was typed since", () => {
    const fluid: NamedClass = {
      ...eyebrow,
      fluidSizes: { [BASE_BREAKPOINT]: { small: 15.5, large: 31.5 } },
    };
    mount({ library: [fluid] });
    openParts();
    openFluid();
    // 12px, typed by hand: the stored sizes no longer made it.
    expect(
      (screen.getByLabelText("On small screens") as HTMLInputElement).value
    ).toBe("12");
  });
});
