// @vitest-environment jsdom

/**
 * The Design panel's ⋯ menu, as an author meets it: its items and their
 * order, the keyboard, the toast an export ends with and the list of what it
 * did not write, an import refused in part, and the CSS variables it copies.
 */
import {
  compileSiteSheet,
  emitTokenBlocks,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { Toaster } from "@nextlyhq/ui";
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useVariablesTransfer } from "./variables-transfer";

/** The menu and its dialogs, hosted as the Design panel hosts them. */
function Host({
  tokens,
  readOnly = false,
  onChange = () => undefined,
}: {
  tokens: SiteTokenSet;
  readOnly?: boolean;
  onChange?: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const latest = React.useRef(tokens);
  const transfer = useVariablesTransfer({
    onChange: next => {
      latest.current = next;
      onChange(next);
    },
    currentTokens: () => latest.current,
    readOnly,
  });
  return (
    <>
      <div data-testid="header">{transfer.menu}</div>
      <div data-testid="panel">{transfer.overlays}</div>
      <Toaster />
    </>
  );
}

const MORE = "More design actions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
  // The toaster follows the device's scheme, which jsdom cannot answer.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  // A download needs an object URL, which jsdom does not make.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:variables",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
});

const WITH_DARK: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

const WITH_SHADOW: SiteTokenSet = {
  tokens: [
    ...WITH_DARK.tokens,
    {
      name: "shadow.card",
      label: "Card shadow",
      kind: "shadow",
      values: { light: "0 1px 2px rgb(0 0 0 / 0.2)" },
    },
  ],
};

async function openMenu(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole("button", { name: MORE }), {
    key: "Enter",
  });
  return screen.findByRole("menu");
}

async function choose(item: string): Promise<void> {
  await openMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

/** An item's name as a screen reader reads it. */
function nameOf(item: HTMLElement): string {
  return item.getAttribute("aria-label") ?? item.textContent ?? "";
}

/** The toast that says `text`, once it is drawn. */
async function toastSaying(text: RegExp | string): Promise<HTMLElement> {
  const title = await screen.findByText(text);
  const toast = title.closest("[data-sonner-toast]");
  if (!(toast instanceof HTMLElement)) throw new Error("not in a toast");
  return toast;
}

describe("the More design actions menu", () => {
  it("is one ⋯ button in the header, named for assistive technology", () => {
    render(<Host tokens={WITH_DARK} />);
    const header = screen.getByTestId("header");
    const button = within(header).getByRole("button", { name: MORE });
    // No browser tooltip, and no visible words: an icon with its name.
    expect(button.getAttribute("title")).toBeNull();
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("holds the four actions in order, the export's format only as a hint", async () => {
    render(<Host tokens={WITH_DARK} />);
    const menu = await openMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map(nameOf)).toEqual([
      "Import design tokens…",
      "Export design tokens (.json)",
      "Export for Figma",
      "Copy CSS variables",
    ]);
    const tokensItem = items[1] as HTMLElement;
    const hint = document.getElementById(
      tokensItem.getAttribute("aria-describedby") ?? ""
    );
    expect(hint?.textContent).toBe("DTCG 2025.10");
    expect(tokensItem.contains(hint)).toBe(true);
    // "DTCG" is the hint and nowhere else.
    for (const item of items) {
      if (item === tokensItem) continue;
      expect(item.textContent).not.toMatch(/DTCG/);
    }
  });

  it("works from the keyboard: Enter opens it on the first item, arrows move, Escape returns to the button", async () => {
    render(<Host tokens={WITH_DARK} />);
    const button = screen.getByRole("button", { name: MORE });
    button.focus();
    const menu = await openMenu();
    const items = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.keyDown(items[1] as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("leaves Import out for an author who may not change the design", async () => {
    render(<Host tokens={WITH_DARK} readOnly />);
    const menu = await openMenu();
    expect(within(menu).getAllByRole("menuitem").map(nameOf)).toEqual([
      "Export design tokens (.json)",
      "Export for Figma",
      "Copy CSS variables",
    ]);
  });
});

describe("an export ends with a toast", () => {
  it("names the files in words, and leaves no box behind", async () => {
    render(<Host tokens={WITH_DARK} />);
    await choose("Export design tokens (.json)");
    await toastSaying(
      "Design tokens exported: variables, and dark values in a theme file (2 files)"
    );
    // Nothing lasting is drawn in the panel: no report, no Dismiss.
    expect(screen.getByTestId("panel").textContent).toBe("");
    expect(document.querySelector(".nx-vars__report")).toBeNull();
  });

  it("counts one file when no variable has a dark value", async () => {
    render(
      <Host
        tokens={{
          tokens: [
            { name: "space.4", kind: "dimension", values: { light: "1rem" } },
          ],
        }}
      />
    );
    await choose("Export design tokens (.json)");
    await toastSaying("Design tokens exported: variables (1 file)");
  });

  it("names the Figma files by mode", async () => {
    render(<Host tokens={WITH_DARK} />);
    await choose("Export for Figma");
    const toast = await toastSaying(
      "Exported for Figma: light mode and dark mode (2 files)"
    );
    // Everything was written, so there is no list to open.
    expect(
      within(toast).queryByRole("button", { name: "What wasn't exported" })
    ).toBeNull();
  });

  it("says nothing was written when the site has no variables", async () => {
    render(<Host tokens={{ tokens: [] }} />);
    await choose("Export for Figma");
    await toastSaying(/No file was written/);
  });
});

describe("What wasn't exported", () => {
  it("lists a shadow left out of Figma, what happened and why", async () => {
    render(<Host tokens={WITH_SHADOW} />);
    await choose("Export for Figma");
    const toast = await toastSaying(
      "Exported for Figma: light mode and dark mode (2 files)"
    );
    fireEvent.click(
      within(toast).getByRole("button", { name: "What wasn't exported" })
    );
    const list = await screen.findByRole("dialog", {
      name: "What wasn't exported",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    const row = rows[0] as HTMLElement;
    expect(within(row).getByText("Card shadow")).toBeDefined();
    expect(within(row).getByText("Left out")).toBeDefined();
    expect(
      within(row).getByText(
        "Figma keeps shadows as effect styles, not variables."
      )
    ).toBeDefined();
  });

  it("lists a value the token file keeps only for Nextly", async () => {
    render(
      <Host
        tokens={{
          tokens: [
            {
              name: "space.lead",
              label: "Lead",
              kind: "dimension",
              values: { light: "1.5em" },
            },
          ],
        }}
      />
    );
    await choose("Export design tokens (.json)");
    const toast = await toastSaying(
      "Design tokens exported: variables (1 file)"
    );
    fireEvent.click(
      within(toast).getByRole("button", { name: "What wasn't exported" })
    );
    const list = await screen.findByRole("dialog", {
      name: "What wasn't exported",
    });
    const row = within(list).getAllByRole("listitem")[0] as HTMLElement;
    expect(within(row).getByText("Lead")).toBeDefined();
    expect(within(row).getByText("Kept for Nextly only")).toBeDefined();
    expect(
      within(row).getByText("Design tools take sizes in px or rem only.")
    ).toBeDefined();
  });

  it("closes with Escape and hands focus back to the ⋯ button", async () => {
    render(<Host tokens={WITH_SHADOW} />);
    await choose("Export for Figma");
    const toast = await toastSaying(/Exported for Figma/);
    fireEvent.click(
      within(toast).getByRole("button", { name: "What wasn't exported" })
    );
    const list = await screen.findByRole("dialog", {
      name: "What wasn't exported",
    });
    fireEvent.keyDown(list, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: MORE })
    );
  });
});

/** Choose files through the hidden input, as the menu's Import does. */
async function chooseFile(name: string, contents: string): Promise<void> {
  const file = new File([contents], name, { type: "application/json" });
  // jsdom's File has no `text()`, which the transfer reads it with.
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Choose variable files to import"), {
      target: { files: [file] },
    });
  });
}

const COLOUR = {
  $type: "color",
  $value: { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" },
};

/**
 * Put the toaster on a clock the test can move: installed before the toast is
 * made, since a timer set on the real clock is out of the fake one's reach.
 * It still advances by itself, so the waits for the dialog and the toast run.
 */
function onATestClock(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

/** Let a minute pass on the toaster's clock. */
function aMinutePasses(): void {
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
}

describe("an import refused in part", () => {
  it("keeps its message until it is dismissed, naming each refused value and why", async () => {
    onATestClock();
    const onChange = vi.fn();
    render(<Host tokens={WITH_DARK} onChange={onChange} />);
    await chooseFile(
      "partly.tokens.json",
      JSON.stringify({
        color: { accent: COLOUR },
        motion: { ease: { $type: "cubicBezier", $value: [0, 0, 1, 1] } },
      })
    );
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const toast = await toastSaying(
      "Imported 1 variable. 1 value was refused:"
    );
    expect(within(toast).getByText(/"motion\.ease"/).textContent).toMatch(
      /has the type "cubicBezier", which this site has no token kind for/
    );

    // Long after a toast would have gone, it is still there.
    aMinutePasses();
    expect(toast.isConnected).toBe(true);

    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(toast.isConnected).toBe(false));
  });

  it("lets a clean import's toast go by itself", async () => {
    // The control for the one above: the same wait does remove a toast that
    // is not asked to stay.
    onATestClock();
    render(<Host tokens={WITH_DARK} />);
    await chooseFile(
      "clean.tokens.json",
      JSON.stringify({ color: { accent: COLOUR } })
    );
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    const toast = await toastSaying("Imported 1 variable.");
    expect(within(toast).queryByRole("button", { name: "Dismiss" })).toBeNull();
    aMinutePasses();
    await waitFor(() => expect(toast.isConnected).toBe(false));
  });

  it("keeps a file it could not read on screen too, with the reason", async () => {
    render(<Host tokens={WITH_DARK} />);
    await chooseFile("broken.json", "{");
    const toast = await toastSaying(/not valid JSON/);
    expect(
      within(toast).getByRole("button", { name: "Dismiss" })
    ).toBeDefined();
  });
});

describe("Copy CSS variables", () => {
  let copied: string[] = [];
  beforeEach(() => {
    copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  it("copies the site sheet's variable blocks, light and dark, and says so", async () => {
    render(<Host tokens={WITH_DARK} />);
    await choose("Copy CSS variables");
    await toastSaying(
      "CSS variables copied: light and dark values, named --site-…"
    );
    expect(copied).toHaveLength(1);
    const text = copied[0] ?? "";
    expect(text).toBe(`${emitTokenBlocks(WITH_DARK, ":root").css}\n`);
    const sheet = compileSiteSheet(
      { tokens: WITH_DARK, breakpoints: { viewport: [], container: [] } },
      {}
    ).css;
    expect(sheet).toContain(text.trimEnd());
    expect(text).toContain("--site-color-brand:#1d2b6b");
    expect(text).toContain("--site-color-brand:#8fa7ff");
  });

  it("names the site's own prefix", async () => {
    render(<Host tokens={{ ...WITH_DARK, prefix: "--brand-" }} />);
    await choose("Copy CSS variables");
    await toastSaying(
      "CSS variables copied: light and dark values, named --brand-…"
    );
    expect(copied[0]).toContain("--brand-color-brand:");
  });

  it("says so when the browser refuses the clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    render(<Host tokens={WITH_DARK} />);
    await choose("Copy CSS variables");
    await toastSaying(/couldn't be copied/);
  });

  it("is offered to an author who may not change the design", async () => {
    render(<Host tokens={WITH_DARK} readOnly />);
    await choose("Copy CSS variables");
    await toastSaying(/CSS variables copied/);
  });
});
