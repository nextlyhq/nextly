/**
 * What the Body and Headings fonts read and write: one token set holding the
 * font variable and the Site text rows pointing at it, nothing until a font
 * is picked, the fallback of the font's kind, and the missing-Bold check.
 */
import {
  DEFAULT_SITE_TEXT,
  resolveSiteTokens,
  type FontFaceDef,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { roleStack } from "./font-library";
import {
  fontRoleSetting,
  fontRoleWrites,
  missingBold,
  roleFamilies,
  withFontRole,
} from "./site-font-roles-model";
import { withSiteTextRow, withTypeSize } from "./site-text-rows";

const SITE: SiteTokenSet = resolveSiteTokens();
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** A face of a family, from the catalogue or uploaded. */
function face(
  family: string,
  weight: string,
  source?: FontFaceDef["source"]
): FontFaceDef {
  return {
    family,
    weight,
    src: [{ url: `/fonts/${family}-${weight}.woff2`, format: "woff2" }],
    ...(source === undefined ? {} : { source }),
  };
}

const LORA = { kind: "google", id: "lora", category: "serif", subset: "latin" } as const;

function valueOf(tokens: SiteTokenSet, name: string): string | undefined {
  return tokens.tokens.find(token => token.name === name)?.values.light;
}

describe("the Body and Headings fonts", () => {
  it("start unset: Body the site's own font, Headings the body text's, with nothing written", () => {
    expect(fontRoleSetting(SITE, "body")).toEqual({ kind: "unset" });
    expect(fontRoleSetting(SITE, "heading")).toEqual({ kind: "unset" });
    expect(fontRoleWrites(SITE, "body")).toBe("Nothing");
  });

  it("sets Body by writing font.body and pointing the Body row at it, in one set", () => {
    const next = withFontRole(SITE, "body", '"Inter", sans-serif');
    expect(valueOf(next, "font.body")).toBe('"Inter", sans-serif');
    expect(next.siteText?.body).toEqual({ fontFamily: { $token: "font.body" } });
    expect(fontRoleSetting(next, "body")).toEqual({
      kind: "set",
      stack: '"Inter", sans-serif',
    });
    // The heading rows are untouched.
    expect(next.siteText?.h2).toBeUndefined();
    expect(fontRoleWrites(next, "body")).toBe(
      '--site-font-body: "Inter", sans-serif; .nx-pb-page { font-family: var(--site-font-body) }'
    );
  });

  it("sets Headings on all six heading rows, keeping each row's size", () => {
    const next = withFontRole(SITE, "heading", '"Lora", serif');
    expect(valueOf(next, "font.heading")).toBe('"Lora", serif');
    for (const level of HEADINGS) {
      expect(next.siteText?.[level]).toEqual({
        ...DEFAULT_SITE_TEXT[level],
        fontFamily: { $token: "font.heading" },
      });
    }
    expect(next.siteText?.body).toBeUndefined();
  });

  it("takes the font away again, leaving the built-in rows as they were", () => {
    const set = withFontRole(
      withFontRole(SITE, "heading", '"Lora", serif'),
      "body",
      '"Inter", sans-serif'
    );
    const cleared = withFontRole(withFontRole(set, "heading", undefined), "body", undefined);
    expect(cleared.siteText).toEqual({});
    expect(fontRoleSetting(cleared, "heading")).toEqual({ kind: "unset" });
  });

  it("keeps a row the site's code supplies when its font goes, so the code's font never comes back", () => {
    const supplied = { body: { fontFamily: "Georgia, serif" } };
    const cleared = withFontRole(
      { ...SITE, siteText: supplied },
      "body",
      undefined,
      supplied
    );
    expect(cleared.siteText?.body).toEqual({});
  });

  it("says a heading row holding a font of its own makes Headings mixed", () => {
    const set = withFontRole(SITE, "heading", '"Lora", serif');
    const one = withSiteTextRow(
      { ...set, siteText: { ...set.siteText, h3: { fontFamily: "serif" } } },
      "h3",
      { fontFamily: "serif" }
    );
    expect(fontRoleSetting(one, "heading")).toEqual({ kind: "mixed" });
  });
});

describe("what a role's hover says it writes", () => {
  it("says the rule the row writes: a plain font as written, with no variable", () => {
    const tokens = { ...SITE, siteText: { body: { fontFamily: "Georgia, serif" } } };
    expect(fontRoleWrites(tokens, "body")).toBe(
      ".nx-pb-page { font-family: Georgia, serif }"
    );
  });

  it("says the variable a row points at, and the rule reading it", () => {
    const headings = withFontRole(SITE, "heading", '"Lora", serif');
    expect(fontRoleWrites(headings, "heading")).toBe(
      '--site-font-heading: "Lora", serif; h1, h2, h3, h4, h5, h6 { font-family: var(--site-font-heading) }'
    );
    // A row pointed at another font variable names that one.
    const other = {
      ...SITE,
      siteText: { body: { fontFamily: { $token: "font.heading" } } },
    };
    expect(fontRoleWrites(other, "body")).toBe(
      "--site-font-heading: system-ui; .nx-pb-page { font-family: var(--site-font-heading) }"
    );
  });
});

describe("a row's size edits keep the font", () => {
  it("keeps a heading's font when it is pointed at another type size, or reset", () => {
    const set = withFontRole(SITE, "heading", '"Lora", serif');
    const sized = withTypeSize(set, "h2", "font-size.h1");
    expect(sized.siteText?.h2?.fontFamily).toEqual({ $token: "font.heading" });
    expect(sized.siteText?.h2?.fontSize).toEqual({ $token: "font-size.h1" });
    const reset = withSiteTextRow(sized, "h2", undefined);
    expect(reset.siteText?.h2).toEqual({
      ...DEFAULT_SITE_TEXT.h2,
      fontFamily: { $token: "font.heading" },
    });
  });
});

describe("the fallback of a font's kind", () => {
  it("falls back to serif, monospace, or sans-serif for every other kind", () => {
    expect(roleStack("Lora", "serif")).toBe('"Lora", serif');
    expect(roleStack("Fira Code", "monospace")).toBe('"Fira Code", monospace');
    expect(roleStack("Inter", "sans-serif")).toBe('"Inter", sans-serif');
    expect(roleStack("Lobster", "display")).toBe('"Lobster", sans-serif');
    expect(roleStack("Caveat", "handwriting")).toBe('"Caveat", sans-serif');
    expect(roleStack("Uploaded")).toBe('"Uploaded", sans-serif');
  });

  it("stores the family with its kind's fallback for a site font", () => {
    expect(roleFamilies([face("Lora", "400", LORA)], [])).toMatchObject([
      { family: "Lora", stack: '"Lora", serif' },
    ]);
  });
});

describe("a Headings font with no bold", () => {
  const lora = roleFamilies([face("Lora", "400", LORA)], []);

  it("names a catalogue family with no face at 600 or heavier, with the request adding its Bold", () => {
    const tokens = withFontRole(SITE, "heading", '"Lora", serif');
    expect(missingBold(tokens, lora)).toEqual({
      family: "Lora",
      add: { id: "lora", weights: [700], styles: ["normal"], subsets: ["latin"] },
    });
  });

  it("judges headings drawn in the Body font by it", () => {
    const tokens = withFontRole(SITE, "body", '"Lora", serif');
    expect(missingBold(tokens, lora)?.family).toBe("Lora");
  });

  it("offers no add for an uploaded family, and says nothing for one with a bold", () => {
    const uploaded = roleFamilies([face("Mine", "400")], []);
    expect(
      missingBold(withFontRole(SITE, "heading", '"Mine", sans-serif'), uploaded)
    ).toEqual({ family: "Mine" });
    const bold = roleFamilies(
      [face("Lora", "400", LORA), face("Lora", "700", LORA)],
      []
    );
    expect(
      missingBold(withFontRole(SITE, "heading", '"Lora", serif'), bold)
    ).toBeUndefined();
    // An italic bold leaves upright headings with a fake bold.
    const italic = roleFamilies(
      [face("Lora", "400", LORA), { ...face("Lora", "700", LORA), style: "italic" }],
      []
    );
    expect(
      missingBold(withFontRole(SITE, "heading", '"Lora", serif'), italic)?.family
    ).toBe("Lora");
    // A variable face covering 700 draws a bold.
    const variable = roleFamilies([face("Lora", "400 700", LORA)], []);
    expect(
      missingBold(withFontRole(SITE, "heading", '"Lora", serif'), variable)
    ).toBeUndefined();
  });

  it("says nothing for a system font or while no font is picked", () => {
    expect(missingBold(SITE, lora)).toBeUndefined();
    expect(
      missingBold(withFontRole(SITE, "heading", "serif"), lora)
    ).toBeUndefined();
  });
});
