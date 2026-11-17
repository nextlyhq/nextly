// @vitest-environment jsdom

/**
 * A font variable chosen from what the site can draw, and a weight by name:
 * the site's own weights first, and the others marked as drawn by none of
 * its fonts.
 *
 * Driven through the Variables view, with the site's fonts handed in as the
 * editor hands them to the block panel.
 *
 * @module variable-font-controls.test
 */
import { type FontFaceDef, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FontChoicesContext, type FontChoices } from "./font-family-field";
import { TokensPanel, type TokensPanelProps } from "./tokens-panel";

type HostedProps = Omit<TokensPanelProps, "currentTokens" | "onChange"> &
  Partial<Pick<TokensPanelProps, "currentTokens" | "onChange">> & {
    fonts?: FontChoices;
  };

/** The panel with a host that keeps what it is handed, and the site's fonts. */
function Hosted({ fonts, ...props }: HostedProps): React.JSX.Element {
  const [tokens, setTokens] = React.useState(props.tokens);
  const latest = React.useRef(tokens);
  return (
    <FontChoicesContext.Provider value={fonts}>
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
    </FontChoicesContext.Provider>
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

/** Inter at Regular 400 and Bold 700, and no other weight. */
const INTER: readonly FontFaceDef[] = [
  {
    family: "Inter",
    src: [{ url: "/fonts/inter-400.woff2", format: "woff2" }],
    weight: "400",
  },
  {
    family: "Inter",
    src: [{ url: "/fonts/inter-700.woff2", format: "woff2" }],
    weight: "700",
  },
];

const SITE: SiteTokenSet = {
  tokens: [
    {
      name: "font.heading",
      kind: "fontFamily",
      values: { light: '"Inter", sans-serif' },
    },
    { name: "weight.strong", kind: "fontWeight", values: { light: "700" } },
  ],
};

async function openEditor(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

/** The value a write left on a variable, by its name. */
function savedValue(
  onChange: ReturnType<typeof vi.fn>,
  name: string
): string | undefined {
  const set = onChange.mock.calls.at(-1)?.[0] as SiteTokenSet | undefined;
  return set?.tokens.find(token => token.name === name)?.values.light;
}

describe("a font variable", () => {
  it("is chosen from the site's fonts and the system's, never typed, ending with Manage fonts…", async () => {
    const onManageFonts = vi.fn();
    render(
      <Hosted
        tokens={SITE}
        fonts={{ faces: INTER, fromCode: [], onManageFonts }}
      />
    );
    const editor = await openEditor(/^Heading/);
    // No box to type a family into.
    expect(within(editor).queryByRole("textbox", { name: "Light" })).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: /^Font, / }));
    // The list's own groups, with no font variables among them.
    const groups = within(screen.getByRole("listbox", { hidden: true }))
      .getAllByRole("group", { hidden: true })
      .map(group => group.getAttribute("aria-label"));
    expect(groups).toEqual(["On this site", "System"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Manage fonts…", hidden: true })
    );
    expect(onManageFonts).toHaveBeenCalled();
  });

  it("stores the family chosen", async () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={SITE}
        onChange={onChange}
        fonts={{ faces: INTER, fromCode: [] }}
      />
    );
    const editor = await openEditor(/^Heading/);
    fireEvent.click(within(editor).getByRole("button", { name: /^Font, / }));
    const system = screen.getByRole("group", { name: "System", hidden: true });
    fireEvent.click(
      within(system).getAllByRole("option", { hidden: true })[0]!
    );
    expect(savedValue(onChange, "font.heading")).not.toBe(
      '"Inter", sans-serif'
    );
    expect(savedValue(onChange, "font.heading")).toBeDefined();
  });
});

describe("a weight variable", () => {
  it("lists the weights by name, the site's own first and the others marked", async () => {
    render(<Hosted tokens={SITE} fonts={{ faces: INTER, fromCode: [] }} />);
    const editor = await openEditor(/^Strong/);
    fireEvent.click(within(editor).getByLabelText("Light"));
    const options = screen
      .getAllByRole("option", { hidden: true })
      .map(option => option.textContent);
    expect(options.slice(0, 2)).toEqual(["Regular 400", "Bold 700"]);
    expect(options.slice(2)).toEqual(
      [
        "Thin 100",
        "Extra light 200",
        "Light 300",
        "Medium 500",
        "Semi bold 600",
        "Extra bold 800",
        "Black 900",
      ].map(name => `${name}No font on this site has this weight`)
    );
  });

  it("counts no weight from a face the site's stylesheet would not load", async () => {
    // Kept in the stored fonts so its issue can be said, never emitted.
    const broken: FontFaceDef = { family: "Inter", src: [], weight: "500" };
    render(
      <Hosted
        tokens={SITE}
        fonts={{ faces: [...INTER, broken], fromCode: [] }}
      />
    );
    const editor = await openEditor(/^Strong/);
    fireEvent.click(within(editor).getByLabelText("Light"));
    expect(
      screen.getByRole("option", { name: /^Medium 500/, hidden: true })
        .textContent
    ).toBe("Medium 500No font on this site has this weight");
  });

  it("stores the weight chosen as its number", async () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={SITE}
        onChange={onChange}
        fonts={{ faces: INTER, fromCode: [] }}
      />
    );
    const editor = await openEditor(/^Strong/);
    fireEvent.click(within(editor).getByLabelText("Light"));
    fireEvent.click(
      screen.getByRole("option", { name: /^Regular 400/, hidden: true })
    );
    expect(savedValue(onChange, "weight.strong")).toBe("400");
  });
});
