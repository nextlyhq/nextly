// @vitest-environment jsdom

/**
 * The top of Design → Type: "Body font" and "Headings font". Each lists the
 * site's fonts, the system's and the entry writing nothing ("Your site's own
 * font", "Same as body" for Headings); a pick is one token set; and a
 * Headings font with no bold says so, with "Add Bold" for a catalogue font.
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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CssNamesContext } from "./css-names-context";
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

  it("shows the fonts read-only, with nothing to open", () => {
    render(<Hosted readOnly />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Body font")).toBeTruthy();
    expect(screen.getByText("Same as body")).toBeTruthy();
  });
});

describe("a Headings font with no bold", () => {
  it("says so, and adds the catalogue font's Bold", async () => {
    const onAddCut = vi.fn(async () => undefined);
    render(
      <Hosted
        tokens={withFontRole(SITE, "heading", '"Lora", serif')}
        onAddCut={onAddCut}
      />
    );
    expect(
      screen.getByText("Lora has no Bold, so browsers draw a fake bold")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Bold" }));
    await waitFor(() =>
      expect(onAddCut).toHaveBeenCalledWith({
        id: "lora",
        weights: [700],
        styles: ["normal"],
        subsets: ["latin"],
      })
    );
  });

  it("says why an add was refused", async () => {
    render(
      <Hosted
        tokens={withFontRole(SITE, "heading", '"Lora", serif')}
        onAddCut={async () => "The font service could not be reached."}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Bold" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The font service could not be reached."
    );
  });

  it("offers no Add Bold for an uploaded font, and says nothing once it has a bold", () => {
    const uploaded: FontFaceDef = {
      ...LORA,
      family: "Mine",
      source: { kind: "upload" },
    };
    const { unmount } = render(
      <Hosted
        faces={[uploaded]}
        tokens={withFontRole(SITE, "heading", '"Mine", sans-serif')}
        onAddCut={async () => undefined}
      />
    );
    expect(
      screen.getByText("Mine has no Bold, so browsers draw a fake bold")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Bold" })).toBeNull();
    unmount();
    render(
      <Hosted
        faces={[LORA, { ...LORA, weight: "700" }]}
        tokens={withFontRole(SITE, "heading", '"Lora", serif')}
      />
    );
    expect(screen.queryByText(/has no Bold/)).toBeNull();
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
