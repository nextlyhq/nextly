// @vitest-environment jsdom

/**
 * A colour's popup beside its row: its name; "☀ Light" with its value and
 * picker; "☾ Dark" with its value and picker, or "Same as light" with "Add
 * dark value"; how widely it is used, with where; its code name with Copy,
 * live while it has never been saved; and its contrast with the site's
 * Background and Text, in light and in dark. A dark value is offered on
 * colours and shadows only, and one another kind already holds is shown,
 * kept, and can be removed.
 */
import { emitTokenBlocks, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
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
      name: "color.background",
      kind: "color",
      values: { light: "#ffffff", dark: "#111827" },
    },
    {
      name: "color.text",
      kind: "color",
      values: { light: "#111827", dark: "#f9fafb" },
    },
    { name: "color.muted", kind: "color", values: { light: "#6b7280" } },
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d4ed8", dark: "#93c5fd" },
    },
    {
      name: "shadow.soft",
      kind: "shadow",
      values: { light: "0 1px 2px rgb(0 0 0 / 0.1)" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
    {
      name: "size.imported",
      kind: "dimension",
      values: { light: "40rem", dark: "48rem" },
    },
    { name: "font-size.body", kind: "dimension", values: { light: "16px" } },
    { name: "line-height.body", kind: "number", values: { light: "1.5" } },
    { name: "weight.bold", kind: "fontWeight", values: { light: "700" } },
    { name: "number.ratio", kind: "number", values: { light: "1.5" } },
    { name: "duration.fast", kind: "duration", values: { light: "200ms" } },
    { name: "custom.grid", kind: "custom", values: { light: "1fr 2fr" } },
  ],
};

async function open(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("a colour's popup", () => {
  it("has its name, ☀ Light with its value and picker, and ☾ Dark with its value and picker", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Brand/);
    expect(
      (within(editor).getByLabelText("Name") as HTMLInputElement).value
    ).toBe("Brand");
    const light = within(editor).getByLabelText("Light") as HTMLInputElement;
    expect(light.value).toBe("#1d4ed8");
    const dark = within(editor).getByLabelText("Dark") as HTMLInputElement;
    expect(dark.value).toBe("#93c5fd");
    // ☀ and ☾ beside the words, for sight; the fields are named in words.
    for (const [field, mode] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const label = editor.querySelector(`label[for="${field.id}"]`);
      expect(label?.querySelector(`[data-mode-icon="${mode}"]`)).not.toBeNull();
    }
    expect(
      within(editor).getByRole("button", { name: /^Pick the light colour/ })
    ).toBeDefined();
    expect(
      within(editor).getByRole("button", { name: /^Pick the dark colour/ })
    ).toBeDefined();
  });

  it('says "Same as light" with "Add dark value" where the colour has none', async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Muted/);
    expect(within(editor).getByText("Same as light")).toBeDefined();
    expect(
      within(editor).getByRole("button", { name: "Add dark value" })
    ).toBeDefined();
  });

  it('removes a dark value with "Remove dark value"', async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await open(/^Brand/);
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove dark value" })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(saved.tokens[3]?.values).toEqual({ light: "#1d4ed8" });
  });

  it("shows its code name with a Copy button, and that a saved one stays on rename", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Brand/);
    expect(within(editor).getByText("--site-color-brand")).toBeDefined();
    expect(within(editor).getByText(/^Code name/)).toBeDefined();
    expect(
      within(editor).getByText(
        "Stays the same when you rename, so CSS that uses it keeps working"
      )
    ).toBeDefined();
    fireEvent.click(within(editor).getByRole("button", { name: "Copy code name" }));
    expect(writeText).toHaveBeenCalledWith("--site-color-brand");
    expect(await within(editor).findByText("Copied")).toBeDefined();
    // Renamed, the code name is the same.
    const name = within(editor).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Harbour" } });
    expect(within(editor).getByText("--site-color-brand")).toBeDefined();
  });

  it("follows a new colour's name with its code name on every keystroke, until it is saved", async () => {
    render(<Hosted tokens={SITE} />);
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    const editor = await screen.findByRole("dialog", { name: "Edit New colour" });
    const name = within(editor).getByLabelText("Name");
    expect(within(editor).getByText("--site-color-new-colour")).toBeDefined();
    fireEvent.change(name, { target: { value: "S" } });
    expect(within(editor).getByText("--site-color-s")).toBeDefined();
    fireEvent.change(name, { target: { value: "Sea" } });
    expect(within(editor).getByText("--site-color-sea")).toBeDefined();
    fireEvent.change(name, { target: { value: "Sea foam" } });
    expect(within(editor).getByText("--site-color-sea-foam")).toBeDefined();
    // Not yet saved: nothing says it stays.
    expect(within(editor).queryByText(/^Stays the same/)).toBeNull();
  });

  it("says how widely it is used, and lists where on request", async () => {
    const usage = host({ "color.brand": reach(3) }, [
      { id: "p1", title: "Home", collection: "pages", kind: "pages" },
      { id: "p2", title: "About", collection: "pages", kind: "pages" },
      { id: "p3", title: "Pricing", collection: "pages", kind: "pages" },
    ]);
    render(<Hosted tokens={SITE} usage={usage} />);
    await screen.findByRole("button", { name: /^Brand.*Used in 3 places$/ });
    const editor = await open(/^Brand/);
    const used = within(editor).getByRole("group", { name: "Where it's used" });
    expect(used.textContent).toContain("Used in 3 places");
    fireEvent.click(within(used).getByRole("button", { name: "Show where" }));
    for (const title of ["Home", "About", "Pricing"]) {
      expect(await within(used).findByText(title)).toBeDefined();
    }
  });
});

describe("a colour's contrast", () => {
  it("shows its ratio with Background and Text, in light and in dark, in words", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Muted/);
    const contrast = within(editor).getByRole("group", { name: "Contrast" });
    const on = within(contrast).getByRole("group", { name: "On Background" });
    // #6b7280 on #ffffff in light; on #111827 in dark, the colour unchanged.
    expect(on.textContent).toContain("4.83:1");
    expect(on.textContent).toContain("Readable as text");
    expect(
      within(contrast).getByRole("group", { name: "With Text" })
    ).toBeDefined();
  });

  it('says "Same in dark mode" beside the dark ratios where the colour has no dark value and Background has one', async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Muted/);
    const dark = within(editor)
      .getByRole("group", { name: "On Background" })
      .querySelector('[data-mode="dark"]');
    expect(dark?.textContent).toContain("Same in dark mode");
    cleanup();
    render(<Hosted tokens={SITE} />);
    const brand = await open(/^Brand/);
    const brandDark = within(brand)
      .getByRole("group", { name: "On Background" })
      .querySelector('[data-mode="dark"]');
    expect(brandDark?.textContent).not.toContain("Same in dark mode");
  });

  it("measures Background against Text only, and Text against Background only", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Background/);
    const contrast = within(editor).getByRole("group", { name: "Contrast" });
    expect(within(contrast).queryByRole("group", { name: "On Background" })).toBeNull();
    expect(within(contrast).getByRole("group", { name: "With Text" })).toBeDefined();
  });

  it("is not shown on a variable that is not a colour", async () => {
    render(<Hosted tokens={SITE} />);
    const editor = await open(/^Space 4/);
    expect(within(editor).queryByRole("group", { name: "Contrast" })).toBeNull();
  });
});

describe("dark values only where they make sense", () => {
  it.each([
    [/^Brand/, true],
    [/^Soft/, true],
    [/^Space 4/, false],
    [/^Body, size/, false],
    [/^Bold/, false],
    [/^Number ratio/, false],
    [/^Fast/, false],
    [/^Custom grid/, false],
  ])("%s offers a dark value: %s", async (row, offered) => {
    const tokens: SiteTokenSet = {
      tokens: SITE.tokens.map(token =>
        token.name === "color.brand"
          ? { ...token, values: { light: token.values.light } }
          : token
      ),
    };
    render(<Hosted tokens={tokens} />);
    const editor = await open(row);
    expect(
      within(editor).queryByRole("button", { name: /^Add dark value/ }) !== null
    ).toBe(offered);
    if (!offered) {
      expect(within(editor).queryByText("Same as light")).toBeNull();
    }
  });

  it("shows a size imported with a dark value, keeps it, and offers to remove it", async () => {
    const onChange = vi.fn();
    render(<Hosted tokens={SITE} onChange={onChange} />);
    const editor = await open(/^Imported/);
    expect(within(editor).getByLabelText("Dark")).toBeDefined();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Remove dark value" })
    );
    const saved = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(
      saved.tokens.find(token => token.name === "size.imported")?.values
    ).toEqual({ light: "40rem" });
  });

  it("still writes the dark value another kind holds", () => {
    const made = emitTokenBlocks(
      { tokens: [SITE.tokens.find(token => token.name === "size.imported")!] },
      ":root"
    );
    expect(made.css).toContain("48rem");
  });
});

/** A usage host answering with these reaches, and these places for a list. */
function host(
  reaches: Record<string, VariableReach>,
  places: readonly {
    id: string;
    title: string;
    collection: string;
    kind: "pages";
  }[]
): VariablesAccess {
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
      items: places,
      total: places.length,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
  } as unknown as VariablesAccess;
}

function reach(documents: number): VariableReach {
  return {
    documents,
    byKind: { pages: documents, components: 0, patterns: 0, layouts: 0 },
    sharedStyles: [],
    blockDefaults: [],
    complete: true,
  };
}

