// @vitest-environment jsdom

/**
 * Design → Type → "Site text": one row each for Body, the six headings,
 * Links, Buttons and Captions, each previewing its look with its pair; a
 * row's popup sets its size and line height together from a type size, or
 * from a typed size and line height; the Links row's colour, hover colour
 * and underline; what each row writes, on hover and inline; and a type size
 * a row uses refused removal, naming the row.
 */
import { resolveSiteTokens, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CssNamesContext } from "./inspector/css-names-context";
import { labelNotInName } from "./label-in-name.fixture";
import { TokensPanel, type TokensPanelProps } from "./tokens-panel";

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

/** The engine's built-ins and one type size the site added. */
const SITE: SiteTokenSet = resolveSiteTokens({
  tokens: [
    {
      id: "t-display",
      name: "font-size.display",
      label: "Display",
      kind: "dimension",
      values: { light: "56px" },
    },
    {
      id: "t-display-line",
      name: "line-height.display",
      kind: "number",
      values: { light: "1.05" },
    },
  ],
});

/** The Site text section of the Type tab. */
function section(): HTMLElement {
  return screen.getByRole("region", { name: "Site text" });
}

/** A Site text row's button, by its name after "Site text: ". */
function siteRow(name: RegExp): HTMLElement {
  return within(section()).getByRole("button", {
    name: new RegExp(`^Site text: ${name.source.replace(/^\^/, "")}`),
  });
}

/** Open a row's popup. */
async function openRow(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(siteRow(name));
  return screen.findByRole("dialog");
}

/** Type into a field and press Enter, which commits it. */
function enter(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
}

describe("the Site text rows", () => {
  it("names each row by its own text, with no label laid over the sample it draws", () => {
    render(<Hosted tokens={SITE} groups={["type", "fonts"]} />);
    const rows = within(section()).getAllByRole("button", {
      name: /^Site text: /,
    });
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      // A label over the row would have to hold its drawn sample sentence
      // too, so the row is named by text inside it, heard as it was before.
      expect(row.getAttribute("aria-label")).toBeNull();
      expect(labelNotInName(row)).toBeNull();
    }
    expect(
      siteRow(/^Heading 1, \d+ \/ [\d.]+$/).getAttribute("data-site-text")
    ).toBe("h1");
  });

  it("has one row each for Body, the six headings, Links, Buttons and Captions, each with its pair", () => {
    render(<Hosted tokens={SITE} groups={["type", "fonts"]} />);
    const rows = within(section()).getAllByRole("button", {
      name: /^Site text: (Body|Heading [1-6]|Links|Buttons|Captions)\b/,
    });
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining("Body"),
      expect.stringContaining("Heading 1"),
      expect.stringContaining("Heading 2"),
      expect.stringContaining("Heading 3"),
      expect.stringContaining("Heading 4"),
      expect.stringContaining("Heading 5"),
      expect.stringContaining("Heading 6"),
      expect.stringContaining("Links"),
      expect.stringContaining("Buttons"),
      expect.stringContaining("Captions"),
    ]);
    expect(siteRow(/^Heading 2/).textContent).toContain("28 / 1.2");
    expect(siteRow(/^Heading 1/).textContent).toContain("36 / 1.15");
    expect(siteRow(/^Body/).textContent).toContain("Your site's own");
    expect(siteRow(/^Captions/).textContent).toContain("Your site's own");
  });

  it("previews sample text in each row's current look", () => {
    render(<Hosted tokens={SITE} groups={["type", "fonts"]} />);
    const preview = (name: RegExp): HTMLElement => {
      const found = siteRow(name).querySelector<HTMLElement>(
        ".nx-site-text__preview"
      );
      if (found === null) throw new Error("no preview");
      return found;
    };
    expect(preview(/^Heading 1/).textContent).toBe("The quick survey");
    // Bigger text previews bigger, within the row's bounds.
    const px = (name: RegExp): number =>
      Number.parseFloat(preview(name).style.fontSize);
    expect(px(/^Heading 1/)).toBeGreaterThan(px(/^Heading 6/));
    expect(preview(/^Heading 2/).style.fontWeight).toBe("700");
  });

  it("is only on the Type tab", () => {
    render(<Hosted tokens={SITE} groups={["colours"]} />);
    expect(screen.queryByRole("region", { name: "Site text" })).toBeNull();
  });
});

describe("a row's popup", () => {
  it("sets the size and line height together from a type size", async () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={SITE} groups={["type", "fonts"]} onChange={onChange} />
    );
    const popup = await openRow(/^Heading 2/);
    expect(
      within(popup).getByRole("radio", { name: "H2 · 28 / 1.2" })
    ).toHaveProperty("checked", true);
    fireEvent.click(
      within(popup).getByRole("radio", { name: "Display · 56 / 1.05" })
    );
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.h2).toEqual({
      fontSize: { $token: "t-display" },
      lineHeight: { $token: "t-display-line" },
    });
    // The row says so once its popup closes.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(siteRow(/^Heading 2/).textContent).toContain("56 / 1.05")
    );
  });

  it("takes a typed size and line height instead", async () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={SITE} groups={["type", "fonts"]} onChange={onChange} />
    );
    const popup = await openRow(/^Body/);
    fireEvent.click(within(popup).getByRole("radio", { name: "Custom size" }));
    enter(within(popup).getByLabelText("Size"), "18");
    enter(within(popup).getByLabelText("Line height"), "1.6");
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.body).toEqual({ fontSize: "18px", lineHeight: 1.6 });
    // "Fluid…" is offered on a typed size.
    expect(within(popup).getByRole("button", { name: "Fluid…" })).toBeDefined();
  });

  it("leaves a row to the site's own CSS", async () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={SITE} groups={["type", "fonts"]} onChange={onChange} />
    );
    const popup = await openRow(/^Heading 3/);
    fireEvent.click(
      within(popup).getByRole("radio", { name: "Your site's own" })
    );
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.h3).toEqual({});
  });

  it("resets a row to the one the site's code supplies, or to the built-in where it supplies none", async () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={{
          ...SITE,
          siteText: { h1: { fontSize: "60px" }, h2: { fontSize: "40px" } },
        }}
        supplied={{ tokens: [], siteText: { h1: { fontSize: "50px" } } }}
        groups={["type", "fonts"]}
        onChange={onChange}
      />
    );
    fireEvent.click(
      within(await openRow(/^Heading 1/)).getByRole("button", {
        name: "Reset",
      })
    );
    let last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.h1).toEqual({ fontSize: "50px" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      within(await openRow(/^Heading 2/)).getByRole("button", {
        name: "Reset",
      })
    );
    last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText).not.toHaveProperty("h2");
  });

  it("keeps a colour typed in a row's popup when a click outside closes it", async () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={SITE} groups={["type", "fonts"]} onChange={onChange} />
    );
    const popup = await openRow(/^Links/);
    const colour = within(popup).getByLabelText("Colour");
    colour.focus();
    fireEvent.change(colour, { target: { value: "#0044cc" } });
    // Closed from outside, with no Enter and no Tab first.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet | undefined;
    expect(last?.siteText?.link).toEqual({ color: "#0044cc" });
  });

  it("gives Links a colour, a colour on hover and an underline", async () => {
    const onChange = vi.fn();
    render(
      <Hosted tokens={SITE} groups={["type", "fonts"]} onChange={onChange} />
    );
    const popup = await openRow(/^Links/);
    // No size: a link takes the size of the text around it.
    expect(
      within(popup).queryByRole("radio", { name: "Custom size" })
    ).toBeNull();
    enter(within(popup).getByLabelText("Colour"), "#0044cc");
    enter(within(popup).getByLabelText("Colour on hover"), "#002266");
    const underline = within(popup).getByRole("group", { name: "Underline" });
    expect(
      within(underline)
        .getAllByRole("radio")
        .map(
          radio =>
            radio.getAttribute("aria-label") ??
            radio.closest("label")?.textContent
        )
    ).toEqual(["Always", "On hover", "Never"]);
    fireEvent.click(within(underline).getByRole("radio", { name: "On hover" }));
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.link).toEqual({
      color: "#0044cc",
      hoverColor: "#002266",
      underline: "hover",
    });
  });

  it("changes nothing while the site's design is read-only", async () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={SITE}
        groups={["type", "fonts"]}
        onChange={onChange}
        readOnly
      />
    );
    const popup = await openRow(/^Heading 2/);
    for (const radio of within(popup).getAllByRole("radio")) {
      expect(radio).toHaveProperty("disabled", true);
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("what a row writes", () => {
  it("is said on hover", async () => {
    render(<Hosted tokens={SITE} groups={["type", "fonts"]} />);
    fireEvent.pointerMove(siteRow(/^Heading 2/));
    const tip = await screen.findByRole("tooltip", {}, { timeout: 2000 });
    expect(tip.textContent).toContain(
      "h2 { font-size: var(--site-font-size-h2); line-height: var(--site-line-height-h2) }"
    );
  });

  it("is printed under the row while Show CSS names is on", () => {
    render(
      <CssNamesContext.Provider value={{ shown: true, set: () => {} }}>
        <Hosted tokens={SITE} groups={["type", "fonts"]} />
      </CssNamesContext.Provider>
    );
    const item = siteRow(/^Heading 2/).closest("li");
    expect(item?.textContent).toContain("font-size, line-height");
  });
});

describe("removing a type size a row uses", () => {
  it("is refused, naming the row", async () => {
    const onChange = vi.fn();
    const used: SiteTokenSet = {
      ...SITE,
      siteText: {
        h1: {
          fontSize: { $token: "t-display" },
          lineHeight: { $token: "t-display-line" },
        },
      },
    };
    render(
      <Hosted tokens={used} groups={["type", "fonts"]} onChange={onChange} />
    );
    const typeGroup = screen.getByRole("region", { name: /^Type scale/ });
    fireEvent.click(
      within(typeGroup).getByRole("button", { name: /^Display/ })
    );
    const editor = await screen.findByRole("dialog");
    fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    expect(
      await within(editor).findByText(
        "Display is used by Site text: Heading 1, so it can't be removed. Point that row at another type size first."
      )
    ).toBeDefined();
    expect(
      within(editor).queryByRole("button", { name: /^Remove Display/ })
    ).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a row following a text style", () => {
  const display = {
    id: "ts-display",
    slug: "display",
    label: "Display",
    orderIndex: 0,
    role: "text" as const,
    styles: { base: { base: { fontSize: "56px", lineHeight: 1.05 } } },
  };

  it("is chosen in its popup, keeping the row's own values, and says so", async () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={{
          ...SITE,
          siteText: { h1: { fontSize: "40px", lineHeight: 1.1 } },
        }}
        groups={["type", "fonts"]}
        classes={[display]}
        onChange={onChange}
      />
    );
    const popup = await openRow(/^Heading 1/);
    fireEvent.click(
      within(popup).getByRole("radio", { name: "Text style: Display" })
    );
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.h1).toEqual({
      fontSize: "40px",
      lineHeight: 1.1,
      textStyle: "ts-display",
    });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        within(section()).getByRole("button", {
          name: "Site text: Heading 1 uses Display",
        })
      ).toBe(siteRow(/^Heading 1/))
    );
  });

  it("offers no text style to the Links row", async () => {
    render(
      <Hosted tokens={SITE} groups={["type", "fonts"]} classes={[display]} />
    );
    const popup = await openRow(/^Links/);
    expect(
      within(popup).queryByRole("radio", { name: /^Text style:/ })
    ).toBeNull();
  });

  it("goes back to a type size, which takes the row off the text style", async () => {
    const onChange = vi.fn();
    render(
      <Hosted
        tokens={{ ...SITE, siteText: { h2: { textStyle: "ts-display" } } }}
        groups={["type", "fonts"]}
        classes={[display]}
        onChange={onChange}
      />
    );
    const popup = await openRow(/^Heading 2/);
    expect(
      within(popup).getByRole("radio", { name: "Text style: Display" })
    ).toHaveProperty("checked", true);
    fireEvent.click(
      within(popup).getByRole("radio", { name: "H2 · 28 / 1.2" })
    );
    const last = onChange.mock.lastCall?.[0] as SiteTokenSet;
    expect(last.siteText?.h2).not.toHaveProperty("textStyle");
  });
});
