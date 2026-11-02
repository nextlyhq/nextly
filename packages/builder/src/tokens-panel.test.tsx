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
