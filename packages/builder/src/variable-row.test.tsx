// @vitest-environment jsdom

/**
 * A variable's compact row: one swatch, split where the dark value differs,
 * its name and a ⋯ button; the ⋯ menu's Rename, Duplicate, dark value and
 * Remove or Reset; renaming in place; and how widely it is used, said in the
 * row's tooltip.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
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

import { TokensPanel, type TokensPanelProps } from "./tokens-panel";
import type {
  VariableReach,
  VariablesAccess,
  VariablesUsage,
} from "./variable-usage";

type HostedProps = Omit<TokensPanelProps, "currentTokens" | "onChange"> &
  Partial<Pick<TokensPanelProps, "onChange">>;

/** The panel with a host that keeps what it is handed, as the editor does. */
function Hosted(props: HostedProps): React.JSX.Element {
  const [tokens, setTokens] = React.useState(props.tokens);
  const latest = React.useRef(tokens);
  return (
    <TokensPanel
      {...props}
      tokens={tokens}
      currentTokens={() => latest.current}
      onChange={next => {
        latest.current = next;
        setTokens(next);
        props.onChange?.(next);
      }}
    />
  );
}

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

const SITE: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
    { name: "color.text", kind: "color", values: { light: "#3b3f46" } },
    {
      name: "color.line",
      kind: "color",
      values: { light: "#e5e7eb", dark: "#e5e7eb" },
    },
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "line-height.body", kind: "dimension", values: { light: "26px" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

const row = (name: RegExp): HTMLElement => screen.getByRole("button", { name });
const more = (name: string): HTMLElement =>
  screen.getByRole("button", { name: `More actions for ${name}` });

/** The row's list item: the row, and the ⋯ beside it. */
const itemOf = (name: RegExp): HTMLElement => {
  const item = row(name).closest("li");
  if (item === null) throw new Error("no list item");
  return item;
};

/** Opens a row's ⋯ menu from the keyboard, as Radix menus open in jsdom. */
async function openMenu(name: string): Promise<HTMLElement> {
  fireEvent.keyDown(more(name), { key: "Enter" });
  return screen.findByRole("menu");
}

const items = (menu: HTMLElement): string[] =>
  within(menu)
    .getAllByRole("menuitem")
    .map(item => item.textContent ?? "");

describe("a colour row", () => {
  it("shows one swatch, its name and a ⋯ button, with no second swatch, count or hint", () => {
    render(<Hosted tokens={SITE} />);
    const colours = screen.getByRole("region", { name: "Colours" });
    const brand = itemOf(/^Brand/);
    expect(brand.querySelectorAll(".nx-vars__swatch")).toHaveLength(1);
    expect(within(brand).getByText("Brand")).toBeDefined();
    expect(more("Brand")).toBeDefined();
    expect(brand.querySelector(".nx-vars__count")).toBeNull();
    expect(colours.textContent).not.toContain("Light / Dark");
    expect(colours.querySelector(".nx-vars__group-hint")).toBeNull();
  });

  it("splits the swatch only where the dark value differs, light at the top left", () => {
    render(<Hosted tokens={SITE} />);
    const swatch = (name: RegExp): HTMLElement => {
      const found = itemOf(name).querySelector<HTMLElement>(".nx-vars__swatch");
      if (found === null) throw new Error("no swatch");
      return found;
    };
    const brand = swatch(/^Brand/);
    expect(brand.hasAttribute("data-split")).toBe(true);
    expect(brand.style.getPropertyValue("--nx-swatch")).toBe("#1d2b6b");
    expect(brand.style.getPropertyValue("--nx-swatch-dark")).toBe("#8fa7ff");
    // No dark value, or one the same as light: one colour, not split.
    expect(swatch(/^Text/).hasAttribute("data-split")).toBe(false);
    expect(swatch(/^Line/).hasAttribute("data-split")).toBe(false);
  });

  it("still says both values to a screen reader", () => {
    render(<Hosted tokens={SITE} />);
    expect(row(/^Brand/).getAttribute("aria-label")).toBe(
      "Brand, light #1d2b6b, dark #8fa7ff"
    );
  });
});

describe("the ⋯ menu", () => {
  it("offers Rename, Duplicate, Add dark value and Remove for a site-made colour", async () => {
    render(<Hosted tokens={SITE} />);
    expect(items(await openMenu("Text"))).toEqual([
      "Rename",
      "Duplicate",
      "Add dark value",
      "Remove",
    ]);
  });

  it("offers Remove dark value where the colour has one", async () => {
    render(<Hosted tokens={SITE} />);
    expect(items(await openMenu("Brand"))).toEqual([
      "Rename",
      "Duplicate",
      "Remove dark value",
      "Remove",
    ]);
  });

  it("offers Reset to built-in instead of Remove for a built-in colour", async () => {
    const supplied: SiteTokenSet = {
      tokens: [
        { name: "color.brand", kind: "color", values: { light: "#000000" } },
      ],
    };
    render(<Hosted tokens={SITE} supplied={supplied} />);
    const menu = await openMenu("Brand");
    expect(items(menu)).toEqual([
      "Rename",
      "Duplicate",
      "Remove dark value",
      "Reset to built-in",
    ]);
  });

  it("resets a changed built-in colour to what the site's code supplies", async () => {
    const onChange = vi.fn();
    const supplied: SiteTokenSet = {
      tokens: [
        { name: "color.brand", kind: "color", values: { light: "#000000" } },
      ],
    };
    render(<Hosted tokens={SITE} supplied={supplied} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Brand")).getByRole("menuitem", {
        name: "Reset to built-in",
      })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[0]?.values).toEqual({ light: "#000000" });
  });

  it("leaves Reset to built-in unavailable while the built-in is unchanged", async () => {
    const supplied: SiteTokenSet = { tokens: [SITE.tokens[1]!] };
    render(<Hosted tokens={SITE} supplied={supplied} />);
    const reset = within(await openMenu("Text")).getByRole("menuitem", {
      name: "Reset to built-in",
    });
    expect(reset.getAttribute("aria-disabled")).toBe("true");
  });

  it("adds a dark value the same as light, and opens the colour to change it", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Text")).getByRole("menuitem", {
        name: "Add dark value",
      })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[1]?.values).toEqual({
      light: "#3b3f46",
      dark: "#3b3f46",
    });
    expect(
      await screen.findByRole("dialog", { name: "Edit Text" })
    ).toBeDefined();
  });

  it("removes a dark value, so dark follows light again", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Brand")).getByRole("menuitem", {
        name: "Remove dark value",
      })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[0]?.values).toEqual({ light: "#1d2b6b" });
  });

  it("asks before Remove, in the colour's popup beside its row", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Text")).getByRole("menuitem", { name: "Remove" })
    );
    const editor = await screen.findByRole("dialog", { name: "Edit Text" });
    const confirm = within(editor).getByRole("group", { name: "Remove Text" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Remove Text" })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens.map(token => token.name)).not.toContain("color.text");
  });

  it("opens from the keyboard on the row, with Shift+F10 or the menu key", async () => {
    render(<Hosted tokens={SITE} />);
    fireEvent.keyDown(row(/^Brand/), { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu")).toBeDefined();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(row(/^Text/), { key: "ContextMenu" });
    expect(items(await screen.findByRole("menu"))[0]).toBe("Rename");
  });

  it("is not drawn where the variables are read-only", () => {
    render(<Hosted tokens={SITE} readOnly />);
    expect(
      screen.queryByRole("button", { name: /^More actions for / })
    ).toBeNull();
  });
});

describe("renaming in place", () => {
  it("edits the name in the row from Rename, and Enter keeps it", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Brand")).getByRole("menuitem", { name: "Rename" })
    );
    const field = (await screen.findByRole("textbox", {
      name: "Name of Brand",
    })) as HTMLInputElement;
    // In the row, not in a popup.
    expect(field.closest("li")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: "Primary" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[0]?.label).toBe("Primary");
    // The code name stays, so CSS that uses it keeps working.
    expect(saved.tokens[0]?.name).toBe("color.brand");
    await waitFor(() => expect(document.activeElement).toBe(row(/^Primary/)));
  });

  it("starts on F2 and keeps the name on leaving the field", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.keyDown(row(/^Text/), { key: "F2" });
    const field = await screen.findByRole("textbox", { name: "Name of Text" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(field, { target: { value: "Body text" } });
    fireEvent.blur(field);
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[1]?.label).toBe("Body text");
    expect(row(/^Body text/)).toBeDefined();
  });

  it("cancels on Escape, keeping the name and handing focus back to the row", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.keyDown(row(/^Brand/), { key: "F2" });
    const field = await screen.findByRole("textbox", { name: "Name of Brand" });
    fireEvent.change(field, { target: { value: "Gone" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(row(/^Brand/)));
  });

  it("keeps the field open and says why where the name is taken", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.keyDown(row(/^Brand/), { key: "F2" });
    const field = await screen.findByRole("textbox", { name: "Name of Brand" });
    fireEvent.change(field, { target: { value: "Text" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const said = field.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(said)?.textContent).not.toBe("");
  });

  it("offers no rename on F2 where the variables are read-only", () => {
    render(<Hosted tokens={SITE} readOnly />);
    fireEvent.keyDown(row(/^Brand/), { key: "F2" });
    expect(screen.queryByRole("textbox", { name: /^Name of / })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Duplicate", () => {
  it('adds "<name> copy" right below the original, with its values, and opens it', async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Brand")).getByRole("menuitem", {
        name: "Duplicate",
      })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    const copy = saved.tokens[1];
    expect(copy?.label).toBe("Brand copy");
    expect(copy?.values).toEqual({ light: "#1d2b6b", dark: "#8fa7ff" });
    expect(copy?.id).toBeUndefined();
    expect(copy?.name).not.toBe("color.brand");
    // Read from the page: the open editor hides the rest from the tree.
    const names = [
      ...document.querySelectorAll('[data-group="colours"] .nx-vars__name'),
    ].map(name => name.textContent);
    expect(names.slice(0, 2)).toEqual(["Brand", "Brand copy"]);
    expect(
      await screen.findByRole("dialog", { name: "Edit Brand copy" })
    ).toBeDefined();
  });

  it("copies a type size with its line height", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(
      within(await openMenu("Body")).getByRole("menuitem", {
        name: "Duplicate",
      })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    const added = saved.tokens.filter(
      token => !SITE.tokens.some(old => old.name === token.name)
    );
    expect(
      added.map(token => [token.name.split(".")[0], token.values])
    ).toEqual([
      ["font-size", { light: "16px" }],
      ["line-height", { light: "26px" }],
    ]);
    expect(added[0]?.name.slice("font-size.".length)).toBe(
      added[1]?.name.slice("line-height.".length)
    );
  });
});

/** A usage host answering with these reaches. */
function host(reaches: Record<string, VariableReach>): VariablesAccess {
  return {
    usage: async (identities: readonly string[]): Promise<VariablesUsage> => ({
      whole: true,
      variables: new Map(
        identities.flatMap(identity => {
          const found = reaches[identity];
          return found === undefined ? [] : [[identity, found] as const];
        })
      ),
    }),
    uses: async () => ({
      items: [],
      page: 1,
      total: 0,
      hasMore: false,
    }),
  } as unknown as VariablesAccess;
}

function reach(documents: number, complete = true): VariableReach {
  return {
    documents,
    byKind: { pages: documents, components: 0, patterns: 0, layouts: 0 },
    sharedStyles: [],
    blockDefaults: [],
    complete,
  };
}

describe("the row's tooltip", () => {
  it("says how widely it is used, that it is not used, or that it is not counted yet", async () => {
    const usage = host({
      "color.brand": reach(14),
      "color.text": reach(0),
      "color.line": reach(0, false),
    });
    render(<Hosted tokens={SITE} usage={usage} />);
    const tip = async (name: RegExp): Promise<string> => {
      const target = await screen.findByRole("button", { name });
      await act(async () => {
        target.focus();
      });
      const said = (await screen.findByRole("tooltip")).textContent ?? "";
      await act(async () => {
        target.blur();
      });
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
      return said;
    };
    expect(await tip(/^Brand.*Used in 14 places$/)).toContain(
      "Used in 14 places"
    );
    expect(await tip(/^Text.*Not used$/)).toContain("Not used");
    expect(await tip(/^Line.*Not counted yet$/)).toContain("Not counted yet");
  });
});
