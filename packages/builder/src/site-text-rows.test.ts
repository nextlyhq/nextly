/**
 * What the Site text rows read and write: each row's pair in the words a
 * designer writes ("28 / 1.2"), the type sizes a row can point at, and the
 * token set an edit of a row produces.
 */
import { resolveSiteTokens, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  pairWords,
  siteTextRowViews,
  siteTextUseWords,
  siteTextWrites,
  typeSizeChoices,
  withSiteTextRow,
  withTypeSize,
} from "./site-text-rows";

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

describe("a row's pair", () => {
  it("reads a size in px at a 16px root beside its line height", () => {
    expect(pairWords("1.75rem", "1.2")).toBe("28 / 1.2");
    expect(pairWords("2.25rem", "1.15")).toBe("36 / 1.15");
    expect(pairWords("18px", undefined)).toBe("18");
    expect(pairWords("clamp(1rem, 0.8rem + 1vw, 1.5rem)", "1.3")).toBe(
      "Fluid 16–24 / 1.3"
    );
  });
});

describe("the rows", () => {
  it("lists Body, the six headings, Links, Buttons and Captions, the headings on their built-in sizes", () => {
    const rows = siteTextRowViews(SITE, "light");
    expect(rows.map(row => row.label)).toEqual([
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
    const h2 = rows.find(row => row.role === "h2");
    expect(h2?.pair).toBe("28 / 1.2");
    expect(h2?.typeSize?.name).toBe("H2");
    for (const role of ["body", "link", "button", "caption"]) {
      expect(rows.find(row => row.role === role)?.pair).toBe("Your site's own");
    }
  });

  it("offers every type size with its line height, by name and pair", () => {
    const choices = typeSizeChoices(SITE, "light");
    expect(choices.map(choice => `${choice.name} · ${choice.pair}`)).toEqual(
      expect.arrayContaining([
        "H2 · 28 / 1.2",
        "Display · 56 / 1.05",
        "Small · 14 / 1.5",
      ])
    );
    const display = choices.find(choice => choice.name === "Display");
    expect(display).toMatchObject({
      size: "t-display",
      lineHeight: "t-display-line",
    });
  });
});

describe("an edit of a row", () => {
  it("sets the size and line height together from a type size", () => {
    const next = withTypeSize(SITE, "h2", "t-display");
    expect(next.siteText?.h2).toEqual({
      fontSize: { $token: "t-display" },
      lineHeight: { $token: "t-display-line" },
    });
    // The rest of the set is untouched.
    expect(next.tokens).toBe(SITE.tokens);
  });

  it("keeps a typed size and line height as plain values", () => {
    const next = withSiteTextRow(SITE, "body", {
      fontSize: "18px",
      lineHeight: 1.6,
    });
    expect(next.siteText?.body).toEqual({ fontSize: "18px", lineHeight: 1.6 });
    expect(siteTextRowViews(next, "light")[0]?.pair).toBe("18 / 1.6");
  });

  it("puts a row back to its built-in value by leaving it out", () => {
    const set = withTypeSize(SITE, "h2", "t-display");
    const back = withSiteTextRow(set, "h2", undefined);
    expect(back.siteText).toEqual({});
    expect(siteTextRowViews(back, "light")[2]?.pair).toBe("28 / 1.2");
  });
});

describe("what a row writes", () => {
  it("names the element and the declarations the compiler writes", () => {
    expect(
      siteTextWrites(SITE, "h2", {
        fontSize: { $token: "font-size.h2" },
        lineHeight: { $token: "line-height.h2" },
      })
    ).toBe(
      "h2 { font-size: var(--site-font-size-h2); line-height: var(--site-line-height-h2) }"
    );
    expect(
      siteTextWrites(SITE, "link", { color: "#0044cc", underline: "hover" })
    ).toBe(
      "a { color: #0044cc; text-decoration: none } a:hover { text-decoration: underline }"
    );
    expect(siteTextWrites(SITE, "body", undefined)).toBe("Nothing");
  });
});

describe("a removal a row refuses", () => {
  it("names the rows using any of the variables", () => {
    const set = withTypeSize(SITE, "h1", "t-display");
    expect(siteTextUseWords(set, ["t-display", "t-display-line"])).toBe(
      "Site text: Heading 1"
    );
    expect(siteTextUseWords(set, ["color.primary"])).toBeUndefined();
  });

  it("names a row reading a variable through var() of its custom property", () => {
    const set: SiteTokenSet = {
      ...SITE,
      siteText: { h2: { fontSize: "var(--site-font-size-display)" } },
    };
    expect(siteTextUseWords(set, ["font-size.display"])).toBe(
      "Site text: Heading 2"
    );
  });
});
