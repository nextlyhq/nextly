// @vitest-environment jsdom

/**
 * The top of Design → Type: "Body font" and "Headings font". Each lists the
 * site's fonts, the system's and the entry writing nothing ("Your site's own
 * font", "Same as body" for Headings); a pick is one token set. A "Fonts"
 * header heads them, with "Manage fonts…" at its end, and a Headings font
 * with no bold draws no warning.
 */
import {
  resolveSiteTokens,
  type FontFaceDef,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CssNamesContext } from "../../inspector/css-names-context";
import { labelNotInName } from "../../label-in-name.fixture";
import { SiteFontRoles, type SiteFontRolesProps } from "./site-font-roles";
import { withFontRole } from "./site-font-roles-model";

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

const SITE: SiteTokenSet = resolveSiteTokens();

/** Lora from the catalogue, Regular only. */
const LORA: FontFaceDef = {
  family: "Lora",
  weight: "400",
  src: [{ url: "/fonts/lora-400.woff2", format: "woff2" }],
  source: { kind: "google", id: "lora", category: "serif", subset: "latin" },
};

/** The rows with a host that keeps what it is handed, as the editor does. */
function Hosted(
  props: Partial<SiteFontRolesProps> & { onSet?: (t: SiteTokenSet) => void }
): React.JSX.Element {
  const [tokens, setTokens] = React.useState(props.tokens ?? SITE);
  return (
    <SiteFontRoles
      readOnly={false}
      faces={[LORA]}
      fromCode={[]}
      {...props}
      tokens={tokens}
      onChange={next => {
        setTokens(next);
        props.onSet?.(next);
      }}
    />
  );
}

/** The list a role's row opens. */
function openList(name: RegExp): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("listbox");
}

describe("the Body and Headings fonts", () => {
  it("shows Body as the site's own font and Headings as the same as body", () => {
    render(<Hosted />);
    expect(
      screen.getByRole("button", { name: "Body font, Your site's own font" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Headings font, Same as body" })
    ).toBeTruthy();
  });

  it("names each row by its own text, with no label laid over the Aa it draws", () => {
    render(<Hosted />);
    for (const name of [/^Body font,/, /^Headings font,/]) {
      const row = screen.getByRole("button", { name });
      // A label over the row would have to hold the "Aa" specimen too, so
      // the row is named by text inside it, heard as it was before.
      expect(row.getAttribute("aria-label")).toBeNull();
      expect(labelNotInName(row)).toBeNull();
    }
  });

  it("lists the entry writing nothing, the site's fonts and the system's", () => {
    render(<Hosted />);
    const list = openList(/^Body font,/);
    const options = within(list)
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(options[0]).toBe("Your site's own font");
    expect(options).toContain("Lora");
    expect(options).toContain("System UI");
    expect(options).toContain("Serif");
    expect(
      within(list).getByRole("group", { name: "On this site" })
    ).toBeTruthy();
    expect(within(list).getByRole("group", { name: "System" })).toBeTruthy();
  });

  it("offers Same as body first in the Headings list", () => {
    render(<Hosted />);
    const list = openList(/^Headings font,/);
    expect(within(list).getAllByRole("option")[0]?.textContent).toBe(
      "Same as body"
    );
  });

  it("writes a pick as one set: the variable and the rows pointing at it", () => {
    const onSet = vi.fn();
    render(<Hosted onSet={onSet} />);
    fireEvent.click(
      within(openList(/^Body font,/)).getByRole("option", { name: "Lora" })
    );
    expect(onSet).toHaveBeenCalledTimes(1);
    const set = onSet.mock.calls[0]?.[0] as SiteTokenSet;
    expect(
      set.tokens.find(token => token.name === "font.body")?.values.light
    ).toBe('"Lora", serif');
    expect(set.siteText?.body).toEqual({ fontFamily: { $token: "font.body" } });
    expect(
      screen.getByRole("button", { name: "Body font, Lora" })
    ).toBeTruthy();
  });

  it("takes Headings back to the same as body", () => {
    const onSet = vi.fn();
    render(
      <Hosted tokens={withFontRole(SITE, "heading", "serif")} onSet={onSet} />
    );
    expect(
      screen.getByRole("button", { name: "Headings font, Serif" })
    ).toBeTruthy();
    fireEvent.click(
      within(openList(/^Headings font,/)).getByRole("option", {
        name: "Same as body",
      })
    );
    const set = onSet.mock.calls[0]?.[0] as SiteTokenSet;
    expect(set.siteText?.h2).toBeUndefined();
  });

  it("shows the fonts read-only, with nothing to open but the Fonts screen", () => {
    render(<Hosted readOnly onManageFonts={() => {}} />);
    expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual([
      "Manage fonts…",
    ]);
    expect(screen.getByText("Body font")).toBeTruthy();
    expect(screen.getByText("Same as body")).toBeTruthy();
  });
});

describe("a Headings font with no bold", () => {
  it("draws no missing-Bold line and offers no Add Bold", () => {
    // Lora is loaded at 400 only, so a browser fakes its bold headings.
    render(
      <Hosted
        faces={[LORA]}
        tokens={withFontRole(SITE, "heading", '"Lora", serif')}
        onManageFonts={() => {}}
      />
    );
    // The row draws Lora as the Headings font, so a missing bold is in play.
    expect(
      screen.getByRole("button", { name: "Headings font, Lora" })
    ).toBeTruthy();
    expect(screen.queryByText(/has no Bold/)).toBeNull();
    expect(screen.queryByText(/fake bold/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Bold" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the Fonts header", () => {
  it("heads the two rows, with Manage fonts… at its end", () => {
    const onManageFonts = vi.fn();
    render(<Hosted onManageFonts={onManageFonts} />);
    const section = screen.getByRole("region", { name: "Fonts" });
    const heading = within(section).getByRole("heading", { name: "Fonts" });
    const head = heading.parentElement;
    expect(head?.classList.contains("nx-vars__group-head")).toBe(true);
    const manage = within(section).getByRole("button", {
      name: "Manage fonts…",
    });
    // In the header row, after the heading: its last part.
    expect(manage.parentElement).toBe(head);
    expect(head?.lastElementChild).toBe(manage);
    // The rows come after the header, inside the same section.
    const body = within(section).getByRole("button", { name: /^Body font,/ });
    expect(
      head!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Where focus returns when the Fonts screen closes.
    expect(manage.getAttribute("data-fonts-manage")).toBe("");
    fireEvent.click(manage);
    expect(onManageFonts).toHaveBeenCalledTimes(1);
  });

  it("keeps the header, with no link, where nothing opens the Fonts screen", () => {
    render(<Hosted />);
    expect(screen.getByRole("heading", { name: "Fonts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage fonts…" })).toBeNull();
  });
});

describe("what a font writes", () => {
  it("is said on hover: the variable and the rule reading it", async () => {
    render(<Hosted tokens={withFontRole(SITE, "body", '"Lora", serif')} />);
    fireEvent.pointerMove(screen.getByRole("button", { name: /^Body font,/ }));
    const tip = await screen.findByRole("tooltip", {}, { timeout: 2000 });
    expect(tip.textContent).toContain(
      '--site-font-body: "Lora", serif; .nx-pb-page { font-family: var(--site-font-body) }'
    );
  });

  it("is printed under the row while Show CSS names is on", () => {
    render(
      <CssNamesContext.Provider value={{ shown: true, set: () => {} }}>
        <Hosted />
      </CssNamesContext.Provider>
    );
    const item = screen
      .getByRole("button", { name: /^Headings font,/ })
      .closest(".nx-font-roles__item");
    expect(item?.textContent).toContain("font-family");
  });
});
