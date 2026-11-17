// @vitest-environment jsdom

/**
 * The Variables view: compact rows in plain words, the editor beside the
 * panel, the keyboard behaviour of that editor, the read-only view, and each
 * state the panel can be in.
 */
import {
  emitTokenBlocks,
  validateStyleValues,
  type SiteTokenSet,
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
  TokensPanel,
  useVariablesHeader,
  type TokensPanelProps,
  type VariablesPreview,
} from "./tokens-panel";
import type { VariableGroup } from "./tokens-studio";

type HostedProps = Omit<TokensPanelProps, "currentTokens" | "onChange"> &
  Partial<Pick<TokensPanelProps, "currentTokens" | "onChange">>;

/** The panel with a host that keeps what it is handed, as the editor does. */
function Hosted(props: HostedProps): React.JSX.Element {
  const [tokens, setTokens] = React.useState(props.tokens);
  const latest = React.useRef(tokens);
  return (
    <TokensPanel
      {...props}
      tokens={tokens}
      currentTokens={props.currentTokens ?? (() => latest.current)}
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
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "line-height.body", kind: "dimension", values: { light: "26px" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

const row = (name: RegExp): HTMLElement => screen.getByRole("button", { name });

/**
 * The site with a spacing step whose dark value differs, whose chip shows
 * the value of the mode the panel previews: a colour's swatch shows both of
 * its values whatever the preview.
 */
const PREVIEWED: SiteTokenSet = {
  tokens: [
    ...SITE.tokens,
    {
      name: "space.gap",
      kind: "dimension",
      values: { light: "8px", dark: "12px" },
    },
  ],
};

/** The value the panel previews, as the gap's chip shows it. */
const previewed = (): string =>
  row(/^Gap, /).querySelector(".nx-vars__chip")?.textContent ?? "";

describe("the rows", () => {
  it("groups variables under plain headings, with no other group when it is empty", () => {
    render(<Hosted tokens={SITE} />);
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map(h => h.textContent);
    expect(headings).toEqual([
      "Colours",
      "Type scale",
      "Spacing",
      "Radius",
      "Shadows",
    ]);
  });

  it('offers no "Space between blocks" above the spacing variables, whatever a host hands it', () => {
    // Spacing is set per container and by the spacing variables: there is no
    // site-wide spacing switch. A host still passing the old `spacing` prop,
    // as one written against an earlier version would, draws nothing for it.
    const stale: Record<string, unknown> = {
      spacing: { mode: "classic", onChange: () => undefined },
    };
    render(<Hosted tokens={SITE} {...stale} />);
    const spacing = screen.getByRole("region", { name: "Spacing" });
    expect(screen.queryByText("Space between blocks")).toBeNull();
    // The colours' usage filter is the only choice of its kind drawn.
    expect(
      screen
        .queryAllByRole("radiogroup")
        .map(group => group.getAttribute("aria-label"))
    ).toEqual(["Show colours"]);
    expect(screen.queryByText(/classic/i)).toBeNull();
    // The spacing variables are listed as before.
    expect(
      within(spacing).getByRole("button", { name: "Space 4, 1rem" })
    ).toBeTruthy();
  });

  it("shows a colour value that is not a colour as invalid, and never as black", async () => {
    // A stored value no browser reads as a colour, as an import can leave.
    const odd: SiteTokenSet = {
      tokens: [
        ...SITE.tokens,
        { name: "color.odd", kind: "color", values: { light: "banana" } },
      ],
    };
    render(<Hosted tokens={odd} />);
    const colour = await openEditor(/^Odd/);
    const swatch = within(colour).getByRole("button", {
      name: /^Pick the light colour/,
    });
    expect(swatch.hasAttribute("data-invalid")).toBe(true);
    expect(swatch.getAttribute("aria-label")).toBe(
      "Pick the light colour (not a valid colour)"
    );
    expect(
      within(colour)
        .getByLabelText(/^Light/)
        .getAttribute("aria-invalid")
    ).toBe("true");
    // Opened on it, the picker starts from a neutral grey, not black.
    fireEvent.click(swatch);
    const values = within(colour)
      .getAllByRole("textbox")
      .map(field => (field as HTMLInputElement).value.toLowerCase());
    expect(values.length).toBeGreaterThan(1);
    expect(values).not.toContain("000000");
    expect(values).not.toContain("#000000");
  });

  it("marks a value invalid as it is typed, and not a colour the picker cannot read", async () => {
    // jsdom computes no CSS and has no CSS.supports, so the browser's own
    // answer is given here, for this test alone.
    const css = CSS as unknown as Record<string, unknown>;
    css.supports = (_property: string, value?: string) =>
      /^(oklch|var)\(/.test(value ?? "");
    try {
      render(<Hosted tokens={SITE} />);
      const colour = await openEditor(/^Brand/);
      const swatch = () =>
        within(colour).getByRole("button", { name: /^Pick the light colour/ });
      // The control: a real colour, unmarked.
      expect(swatch().hasAttribute("data-invalid")).toBe(false);
      const light = within(colour).getByLabelText(/^Light/);
      fireEvent.change(light, { target: { value: "#12" } });
      expect(swatch().hasAttribute("data-invalid")).toBe(true);
      // A colour the picker cannot read is still a colour. Nothing here
      // resolves it, so the swatch is left empty rather than painted.
      fireEvent.change(light, { target: { value: "oklch(0.6 0.2 250)" } });
      expect(swatch().hasAttribute("data-invalid")).toBe(false);
      expect(light.getAttribute("aria-invalid")).toBeNull();
      expect(swatch().style.getPropertyValue("--nx-swatch")).toBe("");
      // A variable would take the panel's own value, not the site's: never
      // painted, and never marked.
      fireEvent.change(light, { target: { value: "var(--brand)" } });
      expect(swatch().hasAttribute("data-invalid")).toBe(false);
      expect(swatch().style.getPropertyValue("--nx-swatch")).toBe("");
      // A colour resolved here is painted.
      fireEvent.change(light, { target: { value: "#336699" } });
      expect(swatch().style.getPropertyValue("--nx-swatch")).toBe("#336699");
    } finally {
      delete css.supports;
    }
  });

  it("clears a colour's refusal once its stored value is typed back", async () => {
    render(<Hosted tokens={SITE} />);
    const colour = await openEditor(/^Brand/);
    const light = within(colour).getByLabelText(/^Light/);
    fireEvent.change(light, { target: { value: "#12345" } });
    fireEvent.keyDown(light, { key: "Enter" });
    expect(light.getAttribute("aria-invalid")).toBe("true");
    // The value it held, put back, is the fix: the refusal goes.
    fireEvent.change(light, { target: { value: "#1d2b6b" } });
    fireEvent.keyDown(light, { key: "Enter" });
    expect(light.getAttribute("aria-invalid")).toBeNull();
    expect(within(colour).queryByText(/is not a hex colour/)).toBeNull();
  });

  it("lets typing take over from a picker gesture", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const colour = await openEditor(/^Brand/);
    const swatch = () =>
      within(colour).getByRole("button", { name: /^Pick the light colour/ });
    fireEvent.click(swatch());
    fireEvent.keyDown(
      within(colour).getByRole("application", {
        name: /Saturation and brightness/,
      }),
      { key: "ArrowRight" }
    );
    // Typed after the picker moved, the text is what the field says: judged
    // as typed, not hidden behind the picker's colour.
    const light = within(colour).getByLabelText(/^Light/);
    fireEvent.change(light, { target: { value: "#12" } });
    expect(swatch().hasAttribute("data-invalid")).toBe(true);
    // Closing the picker writes nothing over the typed text.
    fireEvent.click(swatch());
    expect(onChange).not.toHaveBeenCalled();
    expect((light as HTMLInputElement).value).toBe("#12");
  });

  it("names a row in plain words and says its values, with no usage count", () => {
    render(<Hosted tokens={SITE} />);
    const brand = row(/^Brand/);
    expect(brand.textContent).toContain("Brand");
    expect(brand.textContent).not.toContain("color.brand");
    // Named as one phrase, the visible name first.
    expect(brand.getAttribute("aria-label")).toBe(
      "Brand, light #1d2b6b, dark #8fa7ff"
    );
    expect(row(/^Text/).getAttribute("aria-label")).toBe(
      "Text, light #3b3f46, dark same as light"
    );
    // A type size and its line height are one row, written "16 / 26".
    expect(row(/^Body/).textContent).toContain("16 / 26");
    expect(screen.queryByText(/used by|uses/i)).toBeNull();
  });

  it("shows a length that changes with the page as Fluid, its whole value on hover", () => {
    // The whole clamp() crowded the name out of the row; the row says what
    // kind of value it is, and the hover and the name say the value.
    const fluid = "clamp(1rem, 0.5rem + 2vw, 2rem)";
    render(
      <Hosted
        tokens={{
          tokens: [
            ...SITE.tokens,
            {
              name: "space.hero",
              kind: "dimension",
              values: { light: fluid },
            },
          ],
        }}
      />
    );
    const section = row(/^Hero/);
    const chip = section.querySelector(".nx-vars__chip");
    expect(chip?.textContent).toBe("Fluid · 16–32px");
    expect(chip?.getAttribute("title")).toBe(fluid);
    expect(section.getAttribute("aria-label")).toBe(`Hero, ${fluid}`);
    // A fixed length still reads as itself, with no hover to add.
    const fixed = row(/^Space 4/).querySelector(".nx-vars__chip");
    expect(fixed?.textContent).toBe("1rem");
    expect(fixed?.getAttribute("title")).toBeNull();
  });

  it("lists a spacing and a radius of one name in their own groups, each under its plain name", () => {
    // `space.tile` and `radius.tile` both read "Tile": each sits under its
    // own heading, so the heading tells them apart and the name stays plain.
    render(
      <Hosted
        tokens={{
          tokens: [
            ...SITE.tokens,
            {
              name: "space.tile",
              kind: "dimension",
              values: { light: "24px" },
            },
            {
              name: "radius.tile",
              kind: "dimension",
              values: { light: "12px" },
            },
          ],
        }}
      />
    );
    const spacing = within(screen.getByRole("region", { name: "Spacing" }));
    const radius = within(screen.getByRole("region", { name: "Radius" }));
    expect(spacing.getByRole("button", { name: /^Tile, 24px$/ })).toBeDefined();
    expect(radius.getByRole("button", { name: /^Tile, 12px$/ })).toBeDefined();
  });

  it("names the code name when two rows of one name are of one kind too", () => {
    // `space.tile` and `spacing.tile` are both spacing steps called "Tile":
    // the kind cannot tell them apart, the code name can.
    render(
      <Hosted
        tokens={{
          tokens: [
            ...SITE.tokens,
            {
              name: "space.tile",
              kind: "dimension",
              values: { light: "24px" },
            },
            {
              name: "spacing.tile",
              kind: "dimension",
              values: { light: "32px" },
            },
          ],
        }}
      />
    );
    expect(row(/^Tile · space\.tile,/).getAttribute("aria-label")).toBe(
      "Tile · space.tile, 24px"
    );
    expect(row(/^Tile · spacing\.tile,/).getAttribute("aria-label")).toBe(
      "Tile · spacing.tile, 32px"
    );
  });

  it("says no kind for one name shown in two groups, whose headings tell them apart", () => {
    // The body font and the body type size both read "Body", each under its
    // own heading.
    render(
      <Hosted
        tokens={{
          tokens: [
            ...SITE.tokens,
            {
              name: "font.body",
              kind: "fontFamily",
              values: { light: "Inter" },
            },
          ],
        }}
      />
    );
    expect(row(/^Body, size/).querySelector(".nx-vars__name-kind")).toBeNull();
  });

  it("never says token to the author", () => {
    render(<Hosted tokens={SITE} />);
    expect(document.body.textContent).not.toMatch(/token/i);
  });

  it("previews dark values when the header switch says Dark", () => {
    render(<Hosted tokens={PREVIEWED} />);
    expect(previewed()).toBe("8px");
    const preview = screen.getByRole("group", { name: "Preview" });
    fireEvent.click(within(preview).getByRole("button", { name: "Dark" }));
    expect(previewed()).toBe("12px");
    expect(
      within(preview).getByRole("button", { name: "Dark" })
    ).toHaveProperty("ariaPressed", "true");
  });

  it("draws the header controls into the element the host gives it", () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    render(<Hosted tokens={SITE} headerActions={slot} />);
    expect(within(slot).getByRole("group", { name: "Preview" })).toBeDefined();
    expect(
      within(slot).getByRole("button", { name: "Import or export" })
    ).toBeDefined();
    slot.remove();
  });

  it("leaves its header to a host that draws one for the whole panel, and previews the host's mode", () => {
    // The host keeps the header across its own tabs, so the panel must take
    // the mode from it and draw no second switch or menu of its own.
    function Host(): React.JSX.Element {
      const header = useVariablesHeader({
        onChange: () => undefined,
        currentTokens: () => PREVIEWED,
        readOnly: false,
      });
      return (
        <>
          <div data-testid="host-header">{header.controls}</div>
          <TokensPanel
            tokens={PREVIEWED}
            onChange={() => undefined}
            currentTokens={() => PREVIEWED}
            header={header}
          />
        </>
      );
    }
    render(<Host />);
    expect(screen.getAllByRole("group", { name: "Preview" })).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Import or export" })
    ).toHaveLength(1);
    const hosted = screen.getByTestId("host-header");
    fireEvent.click(within(hosted).getByRole("button", { name: "Dark" }));
    expect(previewed()).toBe("12px");
  });

  it("shows one line with an Add type size action when there are no type sizes", () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={{ tokens: SITE.tokens.slice(0, 2) }}
        onChange={onChange}
      />
    );
    expect(screen.getByText(/No type sizes yet/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add type size" }));
    const names = (onChange.mock.calls[0]?.[0] as SiteTokenSet).tokens.map(
      t => t.name
    );
    expect(names).toContain("font-size.new-size");
    expect(names).toContain("line-height.new-size");
  });
});

/** Open a row's editor as a pointer or Enter does: the row is a button. */
async function openEditor(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(row(name));
  return screen.findByRole("dialog");
}

/**
 * A size as its field shows it: the number in the field, then the unit in the
 * menu beside it.
 */
function sizeShown(field: HTMLElement): string {
  const unit = field
    .closest(".nx-style-inspector__numeric")
    ?.querySelector(".nx-style-inspector__unit");
  return `${(field as HTMLInputElement).value}${unit?.textContent ?? ""}`;
}

/** Type into a field and press Enter, which commits it. */
function enter(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
}

function escape(): void {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
}

describe("the editor beside the panel", () => {
  it("opens with focus on Name, and Escape returns focus to the row", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Brand/);
    expect(editor.getAttribute("aria-label")).toBe("Edit Brand");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(editor).getByLabelText("Name"))
    );
    expect(within(editor).getByText("--site-color-brand")).toBeDefined();
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row(/^Brand/));
  });

  it("spell-checks none of its fields and lists no earlier entries", async () => {
    /*
     * A colour's fields and a size's fields are drawn by different inputs,
     * so both kinds are opened, and the colour's picker too: its hex field is
     * drawn by the shared picker, which this editor cannot give attributes to
     * directly. Every one of them holds a code-like word or a value, which a
     * spell-checker would underline as misspelt.
     *
     * Read by the attribute's own rule, the nearest element that sets it,
     * since that is how the hex field gets its setting.
     */
    const spellChecked = (field: HTMLElement): boolean =>
      field.closest("[spellcheck]")?.getAttribute("spellcheck") !== "false";
    render(<Hosted tokens={SITE} />);

    const colour = await openEditor(/^Brand/);
    const typed = within(colour).getAllByRole("textbox");
    fireEvent.click(
      within(colour).getByRole("button", { name: "Pick the light colour" })
    );
    const withPicker = within(colour).getAllByRole("textbox");
    // The control: opening the picker really added its hex field.
    expect(withPicker.length).toBeGreaterThan(typed.length);
    for (const field of withPicker) expect(spellChecked(field)).toBe(false);
    for (const field of typed) {
      expect(field.getAttribute("autocomplete")).toBe("off");
    }
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const size = await openEditor(/^Body/);
    const fields = within(size).getAllByRole("textbox");
    expect(fields.length).toBeGreaterThan(1);
    for (const field of fields) {
      expect(spellChecked(field)).toBe(false);
      expect(field.getAttribute("autocomplete")).toBe("off");
    }
  });

  it("keeps Tab inside while it is open, both ways round", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Text/);
    const name = within(editor).getByLabelText("Name");
    await waitFor(() => expect(document.activeElement).toBe(name));
    const remove = within(editor).getByRole("button", { name: "Remove" });
    remove.focus();
    // From the last control Tab wraps to the first, and back again.
    fireEvent.keyDown(remove, { key: "Tab" });
    expect(document.activeElement).toBe(name);
    fireEvent.keyDown(name, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(remove);
  });

  it("renames by the plain name, keeping the code name", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Brand/);
    const name = within(editor).getByLabelText("Name");
    name.focus();
    enter(name, "Brand blue");
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(saved.tokens[0]).toMatchObject({
      name: "color.brand",
      label: "Brand blue",
    });
    // The commit does not rebuild the field, so focus stays where it was.
    expect(document.activeElement).toBe(within(editor).getByLabelText("Name"));
    expect(within(editor).getByLabelText("Name")).toHaveProperty(
      "value",
      "Brand blue"
    );
  });

  it("sets and clears a dark value", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Text/);
    const darkOf = () =>
      (onChange.mock.calls.at(-1)?.[0] as SiteTokenSet).tokens[1]?.values.dark;
    expect(within(editor).getByText("Same as light")).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Add dark value" })
    );
    expect(darkOf()).toBe("#3b3f46");
    enter(within(editor).getByLabelText("Dark"), "#e7e9ee");
    expect(darkOf()).toBe("#e7e9ee");
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove dark value" })
    );
    expect(darkOf()).toBeUndefined();
  });

  it("removes only after a confirm that names the variable", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Text/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(
      within(editor).getByText(/Any block using it loses that style/)
    ).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove Text" })
    );
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(saved.tokens.map(t => t.name)).not.toContain("color.text");
  });

  it("offers Reset only for a code-supplied variable that was changed, and no Remove", async () => {
    const supplied: SiteTokenSet = {
      tokens: [
        { name: "color.brand", kind: "color", values: { light: "#000000" } },
        { name: "color.text", kind: "color", values: { light: "#3b3f46" } },
      ],
    };
    render(<Hosted tokens={SITE} supplied={supplied} />);
    let editor = await openEditor(/^Brand/);
    expect(within(editor).getByRole("button", { name: "Reset" })).toBeDefined();
    expect(within(editor).queryByRole("button", { name: "Remove" })).toBeNull();
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    editor = await openEditor(/^Text/);
    expect(within(editor).queryByRole("button", { name: "Reset" })).toBeNull();
    expect(within(editor).queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

describe("the read-only view", () => {
  it("says so, keeps fields selectable, and offers no change", async () => {
    render(<Hosted tokens={SITE} readOnly />);
    expect(
      screen.getByText(
        "You can view the site\u2019s variables but not change them."
      )
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    const editor = await openEditor(/^Brand/);
    expect(editor.getAttribute("aria-label")).toBe("Brand");
    const name = within(editor).getByLabelText("Name") as HTMLInputElement;
    expect(name.readOnly).toBe(true);
    expect(name.disabled).toBe(false);
    expect(
      within(editor).queryByRole("button", {
        name: /Remove|Reset|Add dark|Use light|Pick/,
      })
    ).toBeNull();
  });

  it("leaves Import out of the menu", async () => {
    render(<Hosted tokens={SITE} readOnly />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Import or export" }),
      { key: "Enter" }
    );
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /Import/ })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Export (DTCG)" })
    ).toBeDefined();
  });
});

describe("the import and export menu", () => {
  it("leaves the rest of the panel reachable while it is open", async () => {
    render(<Hosted tokens={SITE} />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Import or export" }),
      { key: "Enter" }
    );
    await screen.findByRole("menu");
    // A modal menu hides everything else from assistive technology while
    // leaving it focusable; this one opens the file chooser and the import
    // preview from inside, as the admin's other action menus do, so it is not
    // modal and nothing outside it is hidden.
    expect(
      document.querySelector(
        '[aria-hidden="true"] input[type="search"], [aria-hidden="true"] [role="searchbox"]'
      )
    ).toBeNull();
    expect(
      screen.getByRole("searchbox", { name: "Search variables" })
    ).toBeDefined();
  });
});

describe("states", () => {
  it("says the variables are being read", () => {
    render(<Hosted tokens={undefined} />);
    expect(screen.getByText("Reading this site’s variables…")).toBeDefined();
  });

  it("alerts when the read failed", () => {
    render(<Hosted tokens={undefined} absence="failed" />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be read/);
  });

  it("alerts when a save failed", () => {
    render(<Hosted tokens={SITE} issue="That change was not saved." />);
    expect(screen.getByRole("alert").textContent).toBe(
      "That change was not saved."
    );
  });

  it("says what a stored save met as a status, with a Reload, and no alert", () => {
    // Nothing failed, so it is not an alert; the words are the host's.
    const onReload = vi.fn();
    const text =
      "Sam changed Primary while you were editing. Your value was kept. Undo puts theirs back.";
    render(<Hosted tokens={SITE} notice={{ text, onReload }} />);
    const status = screen
      .getAllByRole("status")
      .find(each => each.textContent?.includes(text));
    expect(status).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(
      within(status as HTMLElement).getByRole("button", { name: "Reload" })
    );
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("draws no notice when the host gives none", () => {
    render(<Hosted tokens={SITE} />);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("says when a search matches nothing", () => {
    render(<Hosted tokens={SITE} />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search variables" }),
      {
        target: { value: "zzz" },
      }
    );
    expect(screen.getByText("No variables match this search.")).toBeDefined();
  });
});

describe("the add menu and the rest of the editor", () => {
  it("leaves everything around it in the accessibility tree", async () => {
    // A modal menu marks everything outside it aria-hidden while those
    // controls stay focusable (axe: aria-hidden-focus). Nothing is hidden.
    render(<Hosted tokens={SITE} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Add value" }), {
      key: "Enter",
    });
    await screen.findByRole("menu");

    expect(document.querySelector('[data-aria-hidden="true"]')).toBeNull();
  });
});

describe("import and export", () => {
  it("lists the exports with CSS last", async () => {
    render(<Hosted tokens={SITE} />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Import or export" }),
      { key: "Enter" }
    );
    await screen.findByRole("menu");
    expect(
      screen.getAllByRole("menuitem").map(item => item.textContent)
    ).toEqual([
      "Import variables\u2026",
      "Export (DTCG)",
      "Export for Figma",
      "Export CSS",
    ]);
  });

  it("previews an import and changes nothing until it is confirmed", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const contents = JSON.stringify({
      color: {
        accent: {
          $type: "color",
          $value: { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" },
        },
      },
    });
    const file = new File([contents], "accent.tokens.json", {
      type: "application/json",
    });
    // jsdom's File has no `text()`, which the panel reads it with.
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(contents),
    });
    const input = screen.getByLabelText("Choose variable files to import");
    // Reached only through the menu's "Import variables…": a reader browsing
    // the panel meets one way to import, not a second bare file control.
    expect(input.getAttribute("aria-hidden")).toBe("true");
    expect(input.tabIndex).toBe(-1);
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    expect(within(preview).getByText("1 to add")).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(saved.tokens.map(t => t.name)).toContain("color.accent");
    expect(screen.getByRole("status").textContent).toMatch(
      /Imported 1 variable/
    );
  });
});

describe("dark values where they make sense", () => {
  it("gives a spacing variable Light only, with no dark value to add", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Space 4/);
    expect(sizeShown(within(editor).getByLabelText("Light"))).toBe("1rem");
    expect(within(editor).queryByText("Same as light")).toBeNull();
    expect(
      within(editor).queryByRole("button", { name: /^Add dark value/ })
    ).toBeNull();
    expect(within(editor).queryByLabelText("Dark")).toBeNull();
  });

  it("shows a spacing variable's dark value from an import, changes it, and removes it", async () => {
    const onChange = vi.fn();
    const imported: SiteTokenSet = {
      tokens: SITE.tokens.map(token =>
        token.name === "space.4"
          ? { ...token, values: { light: "1rem", dark: "1.5rem" } }
          : token
      ),
    };
    render(<Hosted tokens={imported} onChange={onChange} />);
    const editor = await openEditor(/^Space 4/);
    const darkOf = () =>
      (onChange.mock.calls.at(-1)?.[0] as SiteTokenSet).tokens[4]?.values.dark;
    enter(within(editor).getByLabelText("Dark"), "2rem");
    expect(darkOf()).toBe("2rem");
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove dark value" })
    );
    expect(darkOf()).toBeUndefined();
  });

  it("lays a type size out as one pair: two Light values, and no dark value to add", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Body/);
    expect(sizeShown(within(editor).getByLabelText("Size, light"))).toBe(
      "16px"
    );
    expect(within(editor).getByLabelText("Line height, light")).toHaveProperty(
      "value",
      "26px"
    );
    expect(within(editor).queryByText("Same as light")).toBeNull();
    expect(
      within(editor).queryByRole("button", { name: /^Add dark value/ })
    ).toBeNull();
  });

  it("keeps a type size's dark values from an import, with one action that removes both", async () => {
    const onChange = vi.fn();
    const imported: SiteTokenSet = {
      tokens: SITE.tokens.map(token =>
        token.name === "font-size.body"
          ? { ...token, values: { light: "16px", dark: "18px" } }
          : token.name === "line-height.body"
            ? { ...token, values: { light: "26px", dark: "28px" } }
            : token
      ),
    };
    render(<Hosted tokens={imported} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    const saved = () => onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    enter(within(editor).getByLabelText("Line height, dark"), "30px");
    expect(saved().tokens[3]?.values).toEqual({ light: "26px", dark: "30px" });
    expect(within(editor).getByLabelText("Size, dark")).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove dark value" })
    );
    expect(saved().tokens[2]?.values).toEqual({ light: "16px" });
    expect(saved().tokens[3]?.values).toEqual({ light: "26px" });
  });
});

describe("a type size's line height", () => {
  const REFUSAL = "A line height is a number like 1.4, or a length like 24px.";

  it("says dark follows light when a light edit changes which kind they are", async () => {
    const dark: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "16px" },
        },
        {
          name: "line-height.body",
          kind: "dimension",
          values: { light: "24px", dark: "28px" },
        },
      ],
    };
    render(<Hosted tokens={dark} />);
    const editor = await openEditor(/^Body/);
    enter(within(editor).getByLabelText("Line height, light"), "1.4");
    expect(
      within(editor).getByText("Dark now follows the light value.")
    ).toBeDefined();
  });

  const FOLLOWS = "Dark now follows the light value.";
  const BOTH: SiteTokenSet = {
    tokens: [
      { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
      {
        name: "line-height.body",
        kind: "dimension",
        values: { light: "24px", dark: "28px" },
      },
    ],
  };

  it("drops the dark-follows note when Reset puts the code's values back", async () => {
    render(<Hosted tokens={BOTH} supplied={BOTH} />);
    const editor = await openEditor(/^Body/);
    enter(within(editor).getByLabelText("Line height, light"), "1.4");
    expect(within(editor).getByText(FOLLOWS)).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Reset" }));
    expect(within(editor).queryByText(FOLLOWS)).toBeNull();
  });

  it("drops a refusal when Use light value removes the refused field", async () => {
    const dark: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "16px" },
        },
        {
          name: "line-height.body",
          kind: "dimension",
          values: { light: "24px", dark: "28px" },
        },
      ],
    };
    render(<Hosted tokens={dark} />);
    const editor = await openEditor(/^Body/);
    enter(within(editor).getByLabelText("Line height, dark"), "tall");
    expect(within(editor).getByText(REFUSAL)).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Use light line height" })
    );
    expect(within(editor).queryByText(REFUSAL)).toBeNull();
  });

  it("drops a refusal when Reset puts back the value the site's code supplies", async () => {
    const supplied: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "16px" },
        },
        {
          name: "line-height.body",
          kind: "dimension",
          values: { light: "24px" },
        },
      ],
    };
    render(<Hosted tokens={SITE} supplied={supplied} />);
    const editor = await openEditor(/^Body/);
    const line = within(editor).getByLabelText("Line height, light");
    enter(line, "tall");
    expect(line.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(within(editor).getByRole("button", { name: "Reset" }));
    expect(within(editor).queryByText(REFUSAL)).toBeNull();
    expect(line).toHaveProperty("value", "24px");
    expect(line.getAttribute("aria-invalid")).toBeNull();
  });

  const savedLine = (onChange: ReturnType<typeof vi.fn>) =>
    (onChange.mock.calls.at(-1)?.[0] as SiteTokenSet | undefined)?.tokens.find(
      token => token.name === "line-height.body"
    );

  it("takes a unitless number, stored as a number the page reads unitless", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    const field = within(editor).getByLabelText("Line height, light");
    enter(field, "1.02");

    const line = savedLine(onChange);
    expect(line?.values).toEqual({ light: "1.02" });
    expect(line?.kind).toBe("number");
    // The field keeps what was typed rather than going back to the old value.
    expect(field).toHaveProperty("value", "1.02");

    // What the site's sheet emits: the value as written, with no unit added
    // and nothing reported, which is what a save is judged on.
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    const sheet = emitTokenBlocks(saved, ":root");
    expect(sheet.issues).toEqual([]);
    expect(sheet.css).toContain("--site-line-height-body:1.02");
    // And a block whose line height is bound to it is a valid style.
    const kinds = new Map(saved.tokens.map(token => [token.name, token.kind]));
    expect(
      validateStyleValues(
        { lineHeight: { $token: "line-height.body" } },
        "/styles",
        "strict",
        undefined,
        false,
        { kindOf: name => kinds.get(name) }
      )
    ).toEqual([]);
  });

  it("goes back to a length when a unit is typed", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    const field = within(editor).getByLabelText("Line height, light");
    enter(field, "1.4");
    enter(field, "28px");
    expect(savedLine(onChange)).toMatchObject({
      kind: "dimension",
      values: { light: "28px" },
    });
  });

  it("says why a value is refused, under the field, and keeps what was typed", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    const field = within(editor).getByLabelText("Line height, light");
    enter(field, "tall");

    expect(onChange).not.toHaveBeenCalled();
    expect(
      within(editor).getByText(
        "A line height is a number like 1.4, or a length like 24px."
      )
    ).toBeDefined();
    expect(field).toHaveProperty("value", "tall");
    expect(field.getAttribute("aria-invalid")).toBe("true");

    // A value that is accepted clears the message.
    enter(field, "1.5");
    expect(
      within(editor).queryByText(
        "A line height is a number like 1.4, or a length like 24px."
      )
    ).toBeNull();
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps a refusal until that field is corrected, whatever else is committed", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    const line = within(editor).getByLabelText("Line height, light");
    enter(line, "tall");
    // Another field committed successfully says nothing about this one.
    enter(within(editor).getByLabelText("Size, light"), "18px");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      within(editor).getByText(
        "A line height is a number like 1.4, or a length like 24px."
      )
    ).toBeDefined();
    expect(line).toHaveProperty("value", "tall");
    expect(line.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("a variable added past the first page", () => {
  it("is shown and opened, though its group holds more than a page", async () => {
    const many: SiteTokenSet = {
      tokens: Array.from({ length: 51 }, (_, n) => ({
        name: `color.c${String(n)}`,
        kind: "color" as const,
        values: { light: "#000000" },
      })),
    };
    render(<Hosted tokens={many} />);
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    const editor = await screen.findByRole("dialog");
    expect(editor.getAttribute("aria-label")).toBe("Edit New colour");
    // Its row is mounted too (the open editor hides the rest of the page
    // from the accessibility tree, so it is found by its key).
    expect(
      document.querySelector('[data-variable-key="color.new-colour"]')
    ).not.toBeNull();
  });
});

describe("reset of a code-supplied type size", () => {
  it("is offered when only its line height was changed, and resets that too", async () => {
    const onChange = vi.fn();
    const supplied: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "16px" },
        },
        {
          name: "line-height.body",
          kind: "dimension",
          values: { light: "24px" },
        },
      ],
    };
    render(<Hosted tokens={SITE} supplied={supplied} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    fireEvent.click(within(editor).getByRole("button", { name: "Reset" }));
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(saved.tokens[2]?.values).toEqual({ light: "16px" });
    expect(saved.tokens[3]?.values).toEqual({ light: "24px" });
  });
});

describe("reset compares the whole variable", () => {
  it("is offered when only the description or vendor data differs from the code's", async () => {
    // The stored override keeps any field that differs, so a Reset hidden by
    // a narrower comparison would leave an override nothing can remove.
    for (const differs of [
      { description: "From the brand file" },
      { extensions: { "com.figma.variableId": "VariableID:1:2" } },
    ]) {
      const supplied: SiteTokenSet = {
        tokens: [{ ...SITE.tokens[1]! }],
      };
      const site: SiteTokenSet = {
        tokens: SITE.tokens.map((token, at) =>
          at === 1 ? { ...token, ...differs } : token
        ),
      };
      render(<Hosted tokens={site} supplied={supplied} />);
      const editor = await openEditor(/^Text/);
      expect(
        within(editor).getByRole("button", { name: "Reset" }),
        JSON.stringify(differs)
      ).toBeDefined();
      cleanup();
    }
  });
});

/** Choose one file in the panel's hidden input, as the system chooser would. */
async function chooseFile(name: string, contents: string): Promise<void> {
  const file = new File([contents], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Choose variable files to import"), {
      target: { files: [file] },
    });
  });
}

/** A DTCG file holding these tokens, as this system writes one. */
function fileOf(tokens: SiteTokenSet["tokens"]): string {
  return JSON.stringify({
    color: Object.fromEntries(
      tokens.map(token => [
        token.name.split(".")[1],
        {
          $type: "color",
          $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
          $extensions: {
            "com.nextlyhq.nextly": {
              css: token.values,
              kind: token.kind,
              ...(token.label === undefined ? {} : { label: token.label }),
            },
          },
        },
      ])
    ),
  });
}

describe("the import preview", () => {
  it("shows each field a conflict differs in", async () => {
    render(<Hosted tokens={SITE} />);
    await chooseFile(
      "brand.tokens.json",
      fileOf([
        {
          name: "color.brand",
          kind: "color",
          values: { light: "#1d2b6b", dark: "#222222" },
        },
      ])
    );
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    expect(within(preview).getByText("Dark")).toBeDefined();
    expect(within(preview).getByText("#8fa7ff → #222222")).toBeDefined();
    expect(within(preview).queryByText("#1d2b6b → #1d2b6b")).toBeNull();
  });

  it("names a variable name the import would give twice", async () => {
    render(<Hosted tokens={SITE} />);
    await chooseFile(
      "ink.tokens.json",
      fileOf([
        {
          name: "color.ink",
          label: "Brand",
          kind: "color",
          values: { light: "#000000" },
        },
      ])
    );
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    expect(
      within(preview).getByText(/Two variables would be called "Brand"/)
    ).toBeDefined();
  });
});

describe("a clean export after a refusal", () => {
  it("replaces the refusal with what was saved", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:variables",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });
    render(<Hosted tokens={SITE} />);
    await chooseFile("broken.json", "{");
    expect(screen.getByRole("alert").textContent).toMatch(/not valid JSON/);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Import or export" }),
      { key: "Enter" }
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Export CSS" })
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("status").textContent).toMatch(/Saved/);
  });
});

describe("the type specimen's font", () => {
  it("is the body font found by identity, so a renamed one still draws", () => {
    render(
      <Hosted
        tokens={{
          tokens: [
            ...SITE.tokens,
            {
              id: "font.body",
              name: "font.brand",
              kind: "fontFamily",
              values: { light: "Georgia" },
            },
          ],
        }}
      />
    );
    const specimen = row(/^Body/).querySelector(
      ".nx-vars__specimen"
    ) as HTMLElement;
    expect(specimen.style.fontFamily).toBe("Georgia");
  });
});

describe("the preview's first mode", () => {
  it("is the device's: Dark on a device that prefers dark, and it follows a change", () => {
    let listener: ((event: { matches: boolean }) => void) | undefined;
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: (_: string, next: typeof listener) => {
        listener = next;
      },
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<Hosted tokens={SITE} />);
      const preview = screen.getByRole("group", { name: "Preview" });
      expect(
        within(preview).getByRole("button", { name: "Dark" })
      ).toHaveProperty("ariaPressed", "true");
      act(() => listener?.({ matches: false }));
      expect(
        within(preview).getByRole("button", { name: "Light" })
      ).toHaveProperty("ariaPressed", "true");
    } finally {
      window.matchMedia = original;
    }
  });
});

/** The Design panel's header, held by a host as the editor holds it. */
function HeaderHost({
  preview,
}: {
  preview?: VariablesPreview;
}): React.JSX.Element {
  const header = useVariablesHeader({
    onChange: () => undefined,
    currentTokens: () => PREVIEWED,
    readOnly: false,
    ...(preview === undefined ? {} : { preview }),
  });
  return (
    <>
      <div data-testid="host-header">{header.controls}</div>
      <TokensPanel
        tokens={PREVIEWED}
        onChange={() => undefined}
        currentTokens={() => PREVIEWED}
        header={header}
      />
    </>
  );
}

const pressed = (name: "Light" | "Dark"): string | null =>
  within(screen.getByRole("group", { name: "Preview" })).getByRole("button", {
    name,
  }).ariaPressed;

describe("a preview mode the host holds", () => {
  it("shows the host's pick and hands a press to the host rather than keeping it", () => {
    const onPick = vi.fn();
    const { rerender } = render(
      <HeaderHost preview={{ picked: "dark", onPick }} />
    );
    expect(pressed("Dark")).toBe("true");
    expect(previewed()).toBe("12px");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(onPick).toHaveBeenCalledWith("light");
    // The host has not taken the pick yet, so nothing changed here: a header
    // keeping the press itself would show Light already.
    expect(pressed("Dark")).toBe("true");
    expect(previewed()).toBe("12px");

    rerender(<HeaderHost preview={{ picked: "light", onPick }} />);
    expect(pressed("Light")).toBe("true");
    expect(previewed()).toBe("8px");
  });

  it("keeps a press itself when no host holds the mode", () => {
    render(<HeaderHost />);
    expect(pressed("Light")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(pressed("Dark")).toBe("true");
    expect(previewed()).toBe("12px");
  });
});

describe("the preview while nothing is picked", () => {
  /**
   * A canvas root under a page's own theme marker, on a device that prefers
   * light (jsdom answers no media query), so the canvas draws one mode and
   * the device names the other.
   */
  function canvasUnder(mode: "light" | "dark"): () => void {
    const page = document.createElement("div");
    page.setAttribute("data-nx-theme", mode);
    const root = document.createElement("div");
    root.className = "nx-canvas";
    page.append(root);
    document.body.append(page);
    return () => page.remove();
  }

  it("shows the mode the canvas draws, not the device's, with a host holding none", () => {
    const remove = canvasUnder("dark");
    try {
      render(
        <HeaderHost preview={{ picked: null, onPick: () => undefined }} />
      );
      expect(pressed("Dark")).toBe("true");
      expect(previewed()).toBe("12px");
    } finally {
      remove();
    }
  });

  it("shows the mode the canvas draws on its own too, and follows the page's marker", async () => {
    const remove = canvasUnder("dark");
    try {
      render(<HeaderHost />);
      expect(pressed("Dark")).toBe("true");
      const marked = document.querySelector("[data-nx-theme]");
      // Heard through a mutation observer, which answers after this task.
      marked?.setAttribute("data-nx-theme", "light");
      await waitFor(() => expect(pressed("Light")).toBe("true"));
    } finally {
      remove();
    }
  });
});

describe("a type size whose halves come from different places", () => {
  it("can remove the half the site added, and reset the half its code supplies", async () => {
    const onChange = vi.fn();
    const supplied: SiteTokenSet = {
      tokens: [
        {
          name: "font-size.body",
          kind: "dimension",
          values: { light: "18px" },
        },
      ],
    };
    render(<Hosted tokens={SITE} supplied={supplied} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    expect(within(editor).getByRole("button", { name: "Reset" })).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove line height" })
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove line height of Body" })
    );
    const names = (onChange.mock.calls.at(-1)?.[0] as SiteTokenSet).tokens.map(
      t => t.name
    );
    expect(names).toContain("font-size.body");
    expect(names).not.toContain("line-height.body");
  });
});

describe("a row's name in the dark preview", () => {
  it("says the dark value of a non-colour variable and a type pair", () => {
    const site: SiteTokenSet = {
      tokens: SITE.tokens.map(token =>
        token.name === "space.4"
          ? { ...token, values: { light: "1rem", dark: "2rem" } }
          : token.name === "line-height.body"
            ? { ...token, values: { light: "26px", dark: "30px" } }
            : token
      ),
    };
    render(<Hosted tokens={site} />);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Preview" })).getByRole(
        "button",
        { name: "Dark" }
      )
    );
    expect(row(/^Space 4/).getAttribute("aria-label")).toBe("Space 4, 2rem");
    expect(row(/^Body/).getAttribute("aria-label")).toBe(
      "Body, size 16px, line height 30px"
    );
  });
});

describe("the colour picker in the editor", () => {
  it("has what the open picker held stored before the editor says it is done", async () => {
    // Closing the editor with its picker still open: the picker's colour is
    // committed as it goes away, and the host is told the edit is done after
    // that commit, not before it.
    const events: string[] = [];
    render(
      <Hosted
        tokens={SITE}
        onChange={() => events.push("change")}
        onSettle={() => events.push("settle")}
      />
    );
    const editor = await openEditor(/^Text/);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Pick the light colour" })
    );
    fireEvent.keyDown(
      within(editor).getByLabelText(/^Saturation and brightness/),
      { key: "ArrowRight" }
    );
    expect(events).toEqual([]);
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(events).toContain("change");
    expect(events.at(-1)).toBe("settle");
  });

  it("keeps each step of a gesture rather than snapping back", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await openEditor(/^Text/);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Pick the light colour" })
    );
    const surface = () =>
      within(editor).getByLabelText(/^Saturation and brightness/);
    const saturation = () =>
      Number(
        /(\d+)% saturation/.exec(
          surface().getAttribute("aria-label") ?? ""
        )?.[1]
      );
    const start = saturation();
    fireEvent.keyDown(surface(), { key: "ArrowRight" });
    fireEvent.keyDown(surface(), { key: "ArrowRight" });
    expect(saturation()).toBeGreaterThan(start + 1);
  });
});

describe("an explicit preview preference", () => {
  it("keeps the preview light when the host says so, on a dark device", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      render(<Hosted tokens={SITE} prefersDark={false} />);
      expect(
        within(screen.getByRole("group", { name: "Preview" })).getByRole(
          "button",
          { name: "Light" }
        )
      ).toHaveProperty("ariaPressed", "true");
    } finally {
      window.matchMedia = original;
    }
  });
});

describe("each half of a type pair's dark value", () => {
  it("can go back to its light value on its own", async () => {
    const onChange = vi.fn();
    const site: SiteTokenSet = {
      tokens: SITE.tokens.map(token =>
        token.name === "font-size.body"
          ? { ...token, values: { light: "16px", dark: "18px" } }
          : token.name === "line-height.body"
            ? { ...token, values: { light: "26px", dark: "30px" } }
            : token
      ),
    };
    render(<Hosted tokens={site} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Use light line height" })
    );
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(saved.tokens[2]?.values).toEqual({ light: "16px", dark: "18px" });
    expect(saved.tokens[3]?.values).toEqual({ light: "26px" });
    expect(
      within(editor).getByRole("button", { name: "Use light size" })
    ).toBeDefined();
  });
});

describe("a new variable's code name follows its name", () => {
  it("however the name field is left, a click outside included", async () => {
    // A click outside closed the editor before the name field's blur had
    // committed, so the code name was made from the placeholder name and
    // the rename was lost for good.
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    const editor = await screen.findByRole("dialog");
    const name = within(editor).getByLabelText("Name");
    name.focus();
    fireEvent.change(name, { target: { value: "Brand accent" } });
    // Away from the editor, with the name still in its field.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saved = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    const added = saved.tokens.find(token => token.label === "Brand accent");
    expect(added?.name).toBe("color.brand-accent");
    expect(
      document.querySelector('[data-variable-key="color.brand-accent"]')
    ).not.toBeNull();
  });

  it("is not what search matches: only the name shown is", () => {
    const named: SiteTokenSet = {
      tokens: [
        {
          name: "color.new-colour",
          label: "Brand accent",
          kind: "color",
          values: { light: "#2563eb" },
        },
      ],
    };
    render(<Hosted tokens={named} />);
    const search = screen.getByRole("searchbox", { name: "Search variables" });
    fireEvent.change(search, { target: { value: "new" } });
    expect(
      document.querySelector('[data-variable-key="color.new-colour"]')
    ).toBeNull();
    fireEvent.change(search, { target: { value: "accent" } });
    expect(
      document.querySelector('[data-variable-key="color.new-colour"]')
    ).not.toBeNull();
  });
});

describe("a Design tab's view of the variables", () => {
  /** The panel under a host that keeps the folds, as the Design panel does. */
  function Folding({
    search,
    groups,
    initiallyFolded = [],
  }: {
    search?: string;
    groups?: readonly VariableGroup[];
    initiallyFolded?: readonly string[];
  }): React.JSX.Element {
    const [folded, setFolded] = React.useState<ReadonlySet<string>>(
      new Set(initiallyFolded)
    );
    return (
      <Hosted
        tokens={SITE}
        {...(search === undefined ? {} : { search })}
        {...(groups === undefined ? {} : { groups })}
        folds={{
          folded,
          onFold: (group, fold) =>
            setFolded(current => {
              const next = new Set(current);
              if (fold) next.add(group);
              else next.delete(group);
              return next;
            }),
        }}
      />
    );
  }
  const regions = (): string[] =>
    screen
      .getAllByRole("region")
      .map(region => region.getAttribute("aria-labelledby") ?? "")
      .map(id => document.getElementById(id)?.textContent ?? "");

  it("lists only its tab's groups", () => {
    render(<Folding groups={["colours"]} />);
    expect(regions()).toEqual(["Colours2"]);
    expect(screen.queryByRole("button", { name: /^Space 4/ })).toBeNull();
  });

  it("folds a group by its heading, which says how many it holds", () => {
    render(<Folding />);
    const toggle = screen.getByRole("button", { name: "Colours, 2" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(row(/^Brand/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Brand/ })).toBeNull();
    // The other groups stay open.
    expect(row(/^Space 4/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(row(/^Brand/)).toBeTruthy();
  });

  it("takes its search from the host, opens every group it matches in, and folds none", () => {
    const { rerender } = render(<Folding />);
    fireEvent.click(screen.getByRole("button", { name: "Colours, 2" }));
    expect(screen.queryByRole("button", { name: /^Brand/ })).toBeNull();
    // A search kept by the host: no search box of its own.
    rerender(<Folding search="brand" />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(row(/^Brand/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Space 4/ })).toBeNull();
    // Cleared: the group folded before is folded again.
    rerender(<Folding search="" />);
    expect(screen.queryByRole("button", { name: /^Brand/ })).toBeNull();
    expect(row(/^Space 4/)).toBeTruthy();
  });

  it("offers the add of a group hidden while empty, so its first variable can be made", async () => {
    // Spacing lists "Other values" only once it holds something; its add is
    // a worded line at the end of the tab meanwhile.
    render(<Folding groups={["spacing", "other"]} />);
    expect(screen.queryByRole("button", { name: /^Other values/ })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add value" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Size" }));
    // The group appears with its first variable, its editor open (which
    // hides the rest of the page from the accessibility tree).
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Other values, 1$/, hidden: true })
    ).toBeTruthy();
  });

  it("folds a group's add row away with its rows, and brings it back on opening", () => {
    render(<Folding />);
    const toggle = screen.getByRole("button", { name: "Colours, 2" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Add colour" })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Add colour" })).toBeTruthy();
  });

  it("keeps the host's search when a variable is added, its row held in view", async () => {
    render(<Folding search="brand" />);
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    // Still narrowed: Text, which the search hides, is not drawn.
    expect(
      document.querySelector('[data-variable-key="color.text"]')
    ).toBeNull();
    expect(
      document.querySelector('[data-variable-key="color.new-colour"]')
    ).not.toBeNull();
  });

  it("opens a hidden group the author had folded, for its first variable", async () => {
    render(
      <Folding groups={["spacing", "other"]} initiallyFolded={["other"]} />
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add value" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Size" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^Other values, 1$/, hidden: true })
        .getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("opens a folded group for what is added during a search, once the search is cleared", () => {
    const { rerender } = render(<Folding initiallyFolded={["colours"]} />);
    rerender(<Folding initiallyFolded={["colours"]} search="brand" />);
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    // The search is the host's to clear; cleared, the group stays open.
    rerender(<Folding initiallyFolded={["colours"]} search="" />);
    expect(
      screen
        .getByRole("button", { name: /^Colours, \d+$/, hidden: true })
        .getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("puts focus on the host's search once a variable is removed", async () => {
    // The row and its editor go with the variable; the host's search is the
    // control that stays, as the view's own search is for a standalone view.
    function WithSearch(): React.JSX.Element {
      const searchRef = React.useRef<HTMLInputElement>(null);
      return (
        <>
          <input aria-label="Host search" ref={searchRef} />
          <Hosted tokens={SITE} search="" searchRef={searchRef} />
        </>
      );
    }
    render(<WithSearch />);
    const editor = await openEditor(/^Brand/);
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    fireEvent.click(
      await within(editor).findByRole("button", { name: /^Remove Brand/ })
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Host search" })
      )
    );
  });
});

describe("the editor and the keyboard", () => {
  it("closes the editor on Escape and hands focus back to its row", async () => {
    render(<Hosted tokens={SITE} />);
    const brand = row(/^Brand/);
    brand.focus();
    fireEvent.click(brand);
    const editor = await screen.findByRole("dialog");
    const name = within(editor).getByLabelText("Name");
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.keyDown(name, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row(/^Brand/)));
  });

  it("offers no rename on F2 where the variables are read-only", () => {
    render(<Hosted tokens={SITE} readOnly />);
    const brand = row(/^Brand/);
    fireEvent.keyDown(brand, { key: "F2" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
