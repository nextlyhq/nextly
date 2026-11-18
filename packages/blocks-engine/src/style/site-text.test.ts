import { describe, expect, it } from "vitest";

import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import {
  DEFAULT_SITE_TEXT,
  resolveSiteText,
  SITE_TEXT_LABELS,
  SITE_TEXT_ROLES,
  siteTextElementBases,
  siteTextIssues,
  siteTextRoleOf,
  siteTextStyles,
  siteTextUses,
  type SiteTextMap,
} from "./site-text";
import { compileSiteSheet } from "./site-sheet";
import { resolveSiteTokens } from "./site-tokens";

const NO_BREAKPOINTS = { viewport: [], container: [] };

/** The compiled CSS of an empty page under a site text map. */
function sheetOf(stated?: SiteTextMap): string {
  return compilePageCss(
    { formatVersion: 1, kind: "page", nodes: [] } as never,
    { breakpoints: NO_BREAKPOINTS, elementBases: siteTextElementBases(stated) }
  ).css;
}

describe("site text rows", () => {
  it("has one row each for Body, the six headings, Links, Buttons and Captions", () => {
    expect(SITE_TEXT_ROLES.map(role => SITE_TEXT_LABELS[role])).toEqual([
      "Body",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Links",
      "Buttons",
      "Captions",
    ]);
  });

  it("starts each heading on the built-in type size of its level and every other row empty", () => {
    const rows = resolveSiteText(undefined);
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      expect(rows[level]).toEqual({
        fontSize: { $token: `font-size.${level}` },
        lineHeight: { $token: `line-height.${level}` },
      });
    }
    for (const role of ["body", "link", "button", "caption"] as const) {
      expect(rows[role]).toBeUndefined();
    }
  });

  it("replaces a whole built-in row with a stated one, and keeps the rest", () => {
    const rows = resolveSiteText({ h2: { fontSize: "40px" } });
    // The stated row alone: no built-in line height is kept beside it.
    expect(rows.h2).toEqual({ fontSize: "40px" });
    expect(rows.h1).toEqual(DEFAULT_SITE_TEXT.h1);
  });

  it("lets a heading be left to the site's own CSS with an empty row", () => {
    expect(
      siteTextStyles("h3", resolveSiteText({ h3: {} }).h3)
    ).toBeUndefined();
  });
});

describe("the CSS a row writes", () => {
  it("writes a link's colour, hover colour and underline, and never a size", () => {
    const styles = siteTextStyles("link", {
      color: { $token: "color.primary" },
      hoverColor: "#123456",
      underline: "hover",
    });
    expect(styles).toEqual({
      base: {
        base: { color: { $token: "color.primary" }, textDecoration: "none" },
      },
      hover: { base: { color: "#123456", textDecoration: "underline" } },
    });
  });

  it.each([
    ["always", "underline", undefined],
    ["never", "none", undefined],
  ] as const)("underlines a link %s", (underline, base, hover) => {
    const styles = siteTextStyles("link", { underline });
    expect(styles?.base?.base?.textDecoration).toBe(base);
    expect(styles?.hover?.base?.textDecoration).toBe(hover);
  });

  it("writes a size and a line height for every other row", () => {
    expect(
      siteTextStyles("body", { fontSize: "1.125rem", lineHeight: 1.6 })
    ).toEqual({ base: { base: { fontSize: "1.125rem", lineHeight: 1.6 } } });
  });
});

describe("the element tier a site's text becomes", () => {
  it("writes each heading level at its built-in type size and no rule for body, links or captions", () => {
    const css = sheetOf(undefined);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(css).toContain(
        `.nx-pb-page :where(h${level}) { font-size: var(--site-font-size-h${level}); font-weight: 700; line-height: var(--site-line-height-h${level}); margin-block-end: 0; margin-block-start: 0 }`
      );
    }
    expect(css).not.toMatch(/:where\(a\)/);
    expect(css).not.toMatch(/:where\(figcaption\)/);
    // No rule on the page root itself: nothing for body text.
    expect(css).not.toMatch(/^\.nx-pb-page \{/m);
  });

  it("writes Body on the page root, Links on links and Captions on captions", () => {
    const css = sheetOf({
      body: { fontSize: "18px", lineHeight: 1.6 },
      link: { color: "#0000ff", underline: "always" },
      caption: { fontSize: "0.8rem" },
    });
    expect(css).toMatch(
      /^\.nx-pb-page \{ font-size: 18px; line-height: 1\.6 \}$/m
    );
    expect(css).toContain(
      ".nx-pb-page :where(a) { color: #0000ff; text-decoration: underline }"
    );
    expect(css).toContain(
      ".nx-pb-page :where(figcaption) { font-size: 0.8rem }"
    );
  });

  it("gives no heading or text element an outer margin after any row change", () => {
    const rows: SiteTextMap = Object.fromEntries(
      SITE_TEXT_ROLES.map(role => [
        role,
        role === "link"
          ? { color: "#ff0000", underline: "never" }
          : { fontSize: "21px", lineHeight: 1.3 },
      ])
    );
    const bases = siteTextElementBases(rows);
    for (const tag of [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "ol",
      "ul",
    ] as const) {
      expect(bases[tag]?.base?.base?.margin).toEqual({
        blockStart: "0",
        blockEnd: "0",
      });
    }
    // The rows themselves never hold a margin, and nor do the root, links
    // and captions they are written on.
    for (const role of SITE_TEXT_ROLES) {
      expect(JSON.stringify(siteTextStyles(role, rows[role]))).not.toContain(
        "margin"
      );
    }
    for (const key of ["root", "a", "figcaption"] as const) {
      expect(JSON.stringify(bases[key])).not.toContain("margin");
    }
  });
});

describe("reading a stated map", () => {
  it("accepts every row an author can set", () => {
    expect(
      siteTextIssues({
        body: { fontSize: "16px", lineHeight: 1.6 },
        h2: {
          fontSize: { $token: "font-size.h2" },
          lineHeight: { $token: "line-height.h2" },
        },
        h3: {
          fontSize: "clamp(1rem, 0.9rem + 1vw, 2rem)",
          fluid: { small: 16, large: 32 },
        },
        link: {
          color: "#ff0000",
          hoverColor: { $token: "color.primary" },
          underline: "hover",
        },
        caption: {},
      })
    ).toEqual([]);
  });

  it("refuses an unknown row, a link value on another row, a size on a link and a bad value", () => {
    const issues = siteTextIssues({
      quote: { fontSize: "16px" },
      body: { color: "#ff0000" },
      link: { fontSize: "16px", underline: "sometimes" },
      h1: { fontSize: "a lot" },
      h2: {
        fontSize: { $token: "font-size.h2" },
        fluid: { small: 16, large: 20 },
      },
    });
    expect([...new Set(issues.map(issue => issue.path))].sort()).toEqual([
      "siteText/body/color",
      "siteText/h1/fontSize",
      "siteText/h2/fluid",
      "siteText/link/fontSize",
      "siteText/link/underline",
      "siteText/quote",
    ]);
    expect(issues.every(issue => issue.severity === "error")).toBe(true);
    // A refused value names its row.
    expect(
      issues.find(issue => issue.path === "siteText/h1/fontSize")?.message
    ).toMatch(/^Heading 1's size: /);
  });

  it("refuses a map that is not one", () => {
    expect(siteTextIssues([])).toHaveLength(1);
  });
});

describe("what uses a variable", () => {
  it("names each row pointing at a variable", () => {
    const uses = siteTextUses({
      h1: {
        fontSize: { $token: "font-size.display" },
        lineHeight: { $token: "line-height.display" },
      },
      h2: { fontSize: { $token: "font-size.display" } },
      link: { color: { $token: "color.brand" } },
    });
    expect(uses.get("font-size.display")).toEqual(["h1", "h2"]);
    expect(uses.get("line-height.display")).toEqual(["h1"]);
    expect(uses.get("color.brand")).toEqual(["link"]);
  });

  it("tells a row's own declarations from the ones the tier writes itself", () => {
    expect(siteTextRoleOf("h2", "font-size")).toBe("h2");
    expect(siteTextRoleOf("root", "line-height")).toBe("body");
    expect(siteTextRoleOf("a", "color")).toBe("link");
    expect(siteTextRoleOf("h2", "font-weight")).toBeUndefined();
    // A heading's colour is no row's: only Links writes a colour.
    expect(siteTextRoleOf("h2", "color")).toBeUndefined();
    expect(siteTextRoleOf("a", "font-size")).toBeUndefined();
    expect(siteTextRoleOf("p", "margin-block-start")).toBeUndefined();
  });
});

describe("the Body and Headings fonts", () => {
  /** Every heading row as built in, pointed at the Headings font too. */
  const headingsAt = (font: string) =>
    Object.fromEntries(
      (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map(level => [
        level,
        { ...DEFAULT_SITE_TEXT[level], fontFamily: { $token: font } },
      ])
    );

  it("writes the Body font on the page root and the Headings font on every heading, through their variables", () => {
    const css = sheetOf({
      body: { fontFamily: { $token: "font.body" } },
      ...headingsAt("font.heading"),
    });
    expect(css).toMatch(
      /^\.nx-pb-page \{ font-family: var\(--site-font-body\) \}$/m
    );
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(css).toContain(
        `.nx-pb-page :where(h${level}) { font-family: var(--site-font-heading); font-size: var(--site-font-size-h${level});`
      );
    }
    // Nothing on paragraphs: they take the root's font by inheritance, so a
    // block that sets its own font still passes it to the text inside it.
    expect(css).not.toMatch(/:where\(p\) \{[^}]*font-family/);
  });

  it("writes no font at all for a site that never picked one", () => {
    expect(sheetOf(undefined)).not.toContain("font-family");
    const shared = compileSiteSheet(
      { breakpoints: FIXTURE_BREAKPOINTS, tokens: resolveSiteTokens() },
      {}
    ).css;
    // The variables are declared, and nothing reads them.
    expect(shared).toContain("--site-font-body:");
    expect(shared).not.toContain("font-family");
  });

  it("declares font.body and font.heading for a host's own CSS to read", () => {
    const { css } = compileSiteSheet(
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        tokens: resolveSiteTokens({
          tokens: [
            {
              name: "font.body",
              kind: "fontFamily",
              values: { light: '"Inter", sans-serif' },
            },
          ],
        }),
      },
      {}
    );
    expect(css).toContain('--site-font-body:"Inter", sans-serif');
    // Built in, so a host can read it before the site sets it.
    expect(css).toContain("--site-font-heading:system-ui");
  });

  it("starts the Headings font as a built-in variable no heading reads", () => {
    const heading = resolveSiteTokens().tokens.find(
      token => token.name === "font.heading"
    );
    expect(heading).toMatchObject({ kind: "fontFamily" });
    expect(
      Object.values(DEFAULT_SITE_TEXT).some(
        row => row?.fontFamily !== undefined
      )
    ).toBe(false);
  });

  it("accepts a font on every row but Links, and names the row of a font it refuses", () => {
    expect(
      siteTextIssues({
        body: { fontFamily: { $token: "font.body" } },
        h2: { fontFamily: '"Lora", serif', fontSize: "2rem" },
        caption: { fontFamily: "ui-monospace, monospace" },
      })
    ).toEqual([]);
    const issues = siteTextIssues({
      link: { fontFamily: "serif" },
      body: { fontFamily: "serif; color: red" },
    });
    expect(issues.map(issue => issue.path).sort()).toEqual([
      "siteText/body/fontFamily",
      "siteText/link/fontFamily",
    ]);
    expect(
      issues.find(issue => issue.path === "siteText/body/fontFamily")?.message
    ).toMatch(/^Body's font: /);
  });

  it("names the rows a font variable is used by, and the font as a row's own declaration", () => {
    const uses = siteTextUses({
      body: { fontFamily: { $token: "font.body" } },
      ...headingsAt("font.heading"),
    });
    expect(uses.get("font.body")).toEqual(["body"]);
    expect(uses.get("font.heading")).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ]);
    expect(siteTextRoleOf("root", "font-family")).toBe("body");
    expect(siteTextRoleOf("h3", "font-family")).toBe("h3");
    expect(siteTextRoleOf("a", "font-family")).toBeUndefined();
  });
});
