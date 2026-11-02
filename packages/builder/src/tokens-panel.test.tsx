// @vitest-environment jsdom

/**
 * The Variables view: compact rows in plain words, the editor beside the
 * panel, the keyboard behaviour of that editor, the read-only view, and each
 * state the panel can be in.
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

describe("the rows", () => {
  it("groups variables under plain headings, with no other group when it is empty", () => {
    render(<Hosted tokens={SITE} />);
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map(h => h.textContent);
    expect(headings).toEqual([
      "Colours",
      "Type scale",
      "Spacing, radius & shadows",
    ]);
  });

  it("labels the colour columns beside the Colours heading, for sight only", () => {
    render(<Hosted tokens={SITE} />);
    const colours = screen.getByRole("region", { name: "Colours" });
    const hint = colours.querySelector(".nx-vars__group-hint");
    expect(hint?.textContent).toBe("Light / Dark");
    // The rows already say each value's mode, so the hint is not read twice.
    expect(hint?.getAttribute("aria-hidden")).toBe("true");
    const spacing = screen.getByRole("region", {
      name: "Spacing, radius & shadows",
    });
    expect(spacing.querySelector(".nx-vars__group-hint")).toBeNull();
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

  it("never says token to the author", () => {
    render(<Hosted tokens={SITE} />);
    expect(document.body.textContent).not.toMatch(/token/i);
  });

  it("previews dark values when the header switch says Dark", () => {
    render(<Hosted tokens={SITE} />);
    const swatch = () =>
      row(/^Brand/).querySelector(".nx-vars__swatch--main") as HTMLElement;
    expect(swatch().style.getPropertyValue("--nx-swatch")).toBe("#1d2b6b");
    const preview = screen.getByRole("group", { name: "Preview" });
    fireEvent.click(within(preview).getByRole("button", { name: "Dark" }));
    expect(swatch().style.getPropertyValue("--nx-swatch")).toBe("#8fa7ff");
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
    expect(within(editor).getByText("color.brand")).toBeDefined();
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row(/^Brand/));
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
      within(editor).getByRole("button", { name: "Use light value" })
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

describe("dark values for every kind", () => {
  it("gives a spacing variable Light, then Dark that can be added, changed and cleared", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Space 4/);
    const darkOf = () =>
      (onChange.mock.calls.at(-1)?.[0] as SiteTokenSet).tokens[4]?.values.dark;
    expect(within(editor).getByLabelText("Light")).toHaveProperty(
      "value",
      "1rem"
    );
    expect(within(editor).getByText("Same as light")).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Add dark value" })
    );
    expect(darkOf()).toBe("1rem");
    enter(within(editor).getByLabelText("Dark"), "2rem");
    expect(darkOf()).toBe("2rem");
    fireEvent.click(
      within(editor).getByRole("button", { name: "Use light value" })
    );
    expect(darkOf()).toBeUndefined();
  });

  it("lays a type size out as one pair: two Light values, one action for both darks", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await openEditor(/^Body/);
    const saved = () => onChange.mock.calls.at(-1)?.[0] as SiteTokenSet;
    expect(within(editor).getByLabelText("Size, light")).toHaveProperty(
      "value",
      "16px"
    );
    expect(within(editor).getByLabelText("Line height, light")).toHaveProperty(
      "value",
      "26px"
    );
    // One line and one action for the pair while neither has a dark value.
    expect(within(editor).getAllByText("Same as light")).toHaveLength(1);
    expect(
      within(editor).queryAllByRole("button", { name: /^Add dark value/ })
    ).toHaveLength(1);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Add dark values" })
    );
    expect(saved().tokens[2]?.values).toEqual({ light: "16px", dark: "16px" });
    expect(saved().tokens[3]?.values).toEqual({ light: "26px", dark: "26px" });
    enter(within(editor).getByLabelText("Line height, dark"), "30px");
    expect(saved().tokens[3]?.values).toEqual({ light: "26px", dark: "30px" });
    expect(within(editor).getByLabelText("Size, dark")).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Use light values" })
    );
    expect(saved().tokens[2]?.values).toEqual({ light: "16px" });
    expect(saved().tokens[3]?.values).toEqual({ light: "26px" });
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
