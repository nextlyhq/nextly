/**
 * Where one of the site's fonts is used, as the Fonts screen says it: the
 * Body and Headings fonts, read from the rows they are written on, and the
 * font variables whose first family it is, each with the fallback its text
 * gets once the font is gone.
 *
 * @module font-uses.test
 */
import type { SiteTokenSet, NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  familyUses,
  followedStyleWords,
  roleRefusal,
  nowYourFontWords,
} from "./font-uses";
import { withFontRole } from "./site-font-roles-model";

const BASE: SiteTokenSet = {
  tokens: [
    {
      name: "font.display",
      label: "Display",
      kind: "fontFamily",
      values: { light: '"Lora", Georgia, serif' },
    },
    {
      name: "font.quote",
      label: "Quote",
      kind: "fontFamily",
      values: { light: "Inter, sans-serif", dark: '"Lora", serif' },
    },
    {
      name: "font.code",
      kind: "fontFamily",
      values: { light: "monospace" },
    },
  ],
};

describe("where a font is used", () => {
  it("names nothing for a font nothing uses", () => {
    expect(familyUses("brand", BASE)).toEqual({
      roles: [],
      variables: [],
      counted: [],
    });
  });

  it("names the font variables whose first family it is, in either mode, with each one's fallback", () => {
    const uses = familyUses("lora", BASE);
    expect(uses.roles).toEqual([]);
    expect(uses.variables).toEqual([
      {
        identity: "font.display",
        label: "Display",
        fallback: "Georgia, serif",
      },
      { identity: "font.quote", label: "Quote", fallback: "serif" },
    ]);
  });

  it("names the Body and Headings fonts, and not the variables that hold them", () => {
    const body = withFontRole(BASE, "body", '"Lora", serif');
    const both = withFontRole(body, "heading", '"Lora", serif');
    expect(familyUses("lora", both).roles).toEqual(["body", "heading"]);
    expect(
      familyUses("lora", both).variables.map(entry => entry.identity)
    ).toEqual(["font.display", "font.quote"]);
    // Headings alone: Body keeps the site's own font.
    const headings = withFontRole(BASE, "heading", '"Lora", serif');
    expect(familyUses("lora", headings).roles).toEqual(["heading"]);
  });

  it("names a role whose variable draws the font in dark mode only, and not that variable", () => {
    // Body points at a variable drawn in Inter in light and Lora in dark:
    // removing Lora would change the body text dark-mode visitors see.
    const set: SiteTokenSet = {
      tokens: [
        ...BASE.tokens,
        {
          name: "font.body",
          kind: "fontFamily",
          values: { light: "Inter, sans-serif", dark: '"Lora", serif' },
        },
      ],
      siteText: { body: { fontFamily: { $token: "font.body" } } },
    };
    expect(familyUses("lora", set).roles).toEqual(["body"]);
    expect(familyUses("inter", set).roles).toEqual(["body"]);
    expect(
      familyUses("lora", set).variables.map(entry => entry.identity)
    ).toEqual(["font.display", "font.quote"]);
  });

  it("names Headings for a font any one heading row draws, the rows mixed or partly set", () => {
    // h1 in Lora and h2 in Inter: the picker reads them as mixed, and each
    // font is still a heading's.
    const mixed: SiteTokenSet = {
      ...BASE,
      siteText: {
        h1: { fontFamily: '"Lora", serif' },
        h2: { fontFamily: "Inter, sans-serif" },
      },
    };
    expect(familyUses("lora", mixed).roles).toEqual(["heading"]);
    expect(familyUses("inter", mixed).roles).toEqual(["heading"]);
    // Only h3 names a font, through a variable whose dark value is Lora.
    const partly: SiteTokenSet = {
      ...BASE,
      siteText: { h3: { fontFamily: { $token: "font.quote" } } },
    };
    expect(familyUses("lora", partly).roles).toEqual(["heading"]);
    expect(
      familyUses("lora", partly).variables.map(each => each.identity)
    ).toEqual(["font.display"]);
  });

  it("names Headings for a font a heading row takes from the text style it follows", () => {
    // h1 follows Display, whose font is Lora: the row's own font is not drawn.
    const display = {
      id: "ts-display",
      slug: "display",
      orderIndex: 0,
      role: "text" as const,
      styles: {
        base: { base: { fontFamily: '"Lora", serif' } },
        hover: { tablet: { fontFamily: { $token: "font.display" } } },
      },
    };
    const following: SiteTokenSet = {
      ...BASE,
      siteText: {
        h1: { fontFamily: "Inter, sans-serif", textStyle: "ts-display" },
      },
    };
    expect(familyUses("lora", following, [display]).roles).toEqual(["heading"]);
    expect(familyUses("inter", following, [display]).roles).toEqual([]);
    // A variable the style names, at any state or size, is the role's own.
    expect(
      familyUses("lora", following, [display]).variables.map(
        each => each.identity
      )
    ).toEqual(["font.quote"]);
    // Without the style, the row's own font is the one drawn.
    expect(familyUses("inter", following).roles).toEqual(["heading"]);
  });

  it("names a role whose row reads a site variable through var(), in either mode", () => {
    // Body reads Display (Lora) as CSS; Headings read Quote, Lora in dark.
    const reading: SiteTokenSet = {
      ...BASE,
      siteText: {
        body: { fontFamily: "var(--site-font-display), serif" },
        h1: { fontFamily: "var(--site-font-quote)" },
      },
    };
    expect(familyUses("lora", reading).roles).toEqual(["body", "heading"]);
    expect(familyUses("inter", reading).roles).toEqual(["heading"]);
    // The variables the rows read are said as the roles.
    expect(familyUses("lora", reading).variables).toEqual([]);
    // A var() after the first family is only a fallback.
    const fallback: SiteTokenSet = {
      ...BASE,
      siteText: { body: { fontFamily: "Inter, var(--site-font-display)" } },
    };
    expect(familyUses("lora", fallback).roles).toEqual([]);
  });

  it("reads a var() naming no site variable as its fallback, as the browser draws it", () => {
    // `--unset` is no site variable, so Body draws Lora; h1's fallbacks end
    // at Quote, Inter in light and Lora in dark.
    const unset: SiteTokenSet = {
      tokens: [
        ...BASE.tokens,
        {
          name: "font.alias",
          label: "Alias",
          kind: "fontFamily",
          values: { light: "var(--nope, Lora)" },
        },
      ],
      siteText: {
        body: { fontFamily: "var(--unset, Lora), serif" },
        h1: {
          fontFamily:
            "var(--unset, var(--also-unset, var(--site-font-quote))), serif",
        },
      },
    };
    const lora = familyUses("lora", unset);
    expect(lora.roles).toEqual(["body", "heading"]);
    expect(familyUses("inter", unset).roles).toEqual(["heading"]);
    // Quote, which h1 reads through the fallbacks, is said as Headings; a
    // variable drawing Lora through a fallback is named with its own.
    expect(lora.variables).toEqual([
      {
        identity: "font.display",
        label: "Display",
        fallback: "Georgia, serif",
      },
      {
        identity: "font.alias",
        label: "Alias",
        fallback: "the browser’s own font",
      },
    ]);
  });

  it("reads no font from a var() naming no site variable and giving no fallback", () => {
    // The browser drops the whole value, so the Lora after it is never drawn.
    const dropped: SiteTokenSet = {
      ...BASE,
      siteText: { body: { fontFamily: "var(--unset), Lora" } },
    };
    expect(familyUses("lora", dropped).roles).toEqual([]);
  });

  it("follows a variable that reads another through var(), and stops at a loop", () => {
    // Body points at font.body, which reads Display (Lora) as CSS.
    const aliased: SiteTokenSet = {
      tokens: [
        ...BASE.tokens,
        {
          name: "font.body",
          kind: "fontFamily",
          values: { light: "var(--site-font-display), serif" },
        },
        {
          name: "font.alias",
          kind: "fontFamily",
          values: { light: "Inter", dark: "var(--site-font-display)" },
        },
      ],
      siteText: { body: { fontFamily: { $token: "font.body" } } },
    };
    const lora = familyUses("lora", aliased);
    expect(lora.roles).toEqual(["body"]);
    // A variable reading Lora through another, in dark here, names it too.
    expect(lora.variables.map(each => each.identity)).toEqual([
      "font.display",
      "font.quote",
      "font.alias",
    ]);
    // Two variables reading each other draw no font, and nothing hangs.
    const loop: SiteTokenSet = {
      tokens: [
        {
          name: "font.a",
          kind: "fontFamily",
          values: { light: "var(--site-font-b)" },
        },
        {
          name: "font.b",
          kind: "fontFamily",
          values: { light: "var(--site-font-a)" },
        },
      ],
      siteText: { body: { fontFamily: { $token: "font.a" } } },
    };
    expect(familyUses("lora", loop)).toEqual({
      roles: [],
      variables: [],
      counted: [],
    });
  });

  it("counts the places of every variable naming it, a role's own included", () => {
    const body = withFontRole(BASE, "body", '"Lora", serif');
    const uses = familyUses("lora", body);
    expect(uses.roles).toEqual(["body"]);
    // The role's variable is said as the role, and its places still count.
    expect(uses.variables.map(each => each.identity)).toEqual([
      "font.display",
      "font.quote",
    ]);
    expect([...uses.counted].sort()).toEqual([
      "font.body",
      "font.display",
      "font.quote",
    ]);
  });

  it("matches a family however its case is written", () => {
    const body = withFontRole(BASE, "body", '"LORA", serif');
    expect(familyUses("lora", body).roles).toEqual(["body"]);
  });

  it("says the browser's own font is the fallback where a stack names nothing after the font", () => {
    const lone: SiteTokenSet = {
      tokens: [
        { name: "font.lone", kind: "fontFamily", values: { light: "Lora" } },
      ],
    };
    expect(familyUses("lora", lone).variables[0]?.fallback).toBe(
      "the browser’s own font"
    );
  });

  it("reads nothing before the variables are read", () => {
    expect(familyUses("lora", undefined)).toEqual({
      roles: [],
      variables: [],
      counted: [],
    });
  });
});

describe("what a role's font leaves as it is", () => {
  const style = (id: string, label: string) => ({
    id,
    slug: id,
    label,
    orderIndex: 0,
    role: "text" as const,
    styles: { base: { base: { fontFamily: '"Lora", serif' } } },
  });
  const classes = [style("lead", "Lead"), style("display", "Display")];
  const following: SiteTokenSet = {
    ...BASE,
    siteText: {
      body: { textStyle: "lead" },
      h1: { textStyle: "display" },
      h3: { textStyle: "lead" },
      h4: { textStyle: "display" },
      // A text style the site doesn't have is not followed.
      h5: { textStyle: "gone" },
    },
  };

  it("names the rows following each text style, role by role", () => {
    expect(followedStyleWords(following, ["body", "heading"], classes)).toEqual(
      [
        "Body follows the text style “Lead”, so a body font doesn’t change it.",
        "Heading 1 and Heading 4 follow the text style “Display”, so a headings font doesn’t change them.",
        "Heading 3 follows the text style “Lead”, so a headings font doesn’t change it.",
      ]
    );
    expect(followedStyleWords(following, ["body"], classes)).toEqual([
      "Body follows the text style “Lead”, so a body font doesn’t change it.",
    ]);
  });

  it("promises nothing for a text style that uses the role's own font, or sets none", () => {
    const withFont = (
      id: string,
      label: string,
      fontFamily?: { readonly $token: string }
    ): NamedClass => ({
      ...style(id, label),
      styles: {
        base: { base: fontFamily === undefined ? {} : { fontFamily } },
      },
    });
    const roleStyles = [
      // Follows the Headings font: choosing one does change these rows.
      withFont("display", "Display", { $token: "font.heading" }),
      // Sets no font: the row's font comes from elsewhere, so no promise.
      withFont("lead", "Lead"),
    ];
    expect(
      followedStyleWords(following, ["body", "heading"], roleStyles)
    ).toEqual([]);
    // A style naming the OTHER role's font keeps its rows for this role.
    const bodyStyled = [
      withFont("display", "Display", { $token: "font.body" }),
      withFont("lead", "Lead"),
    ];
    expect(followedStyleWords(following, ["heading"], bodyStyled)).toEqual([
      "Heading 1 and Heading 4 follow the text style “Display”, so a headings font doesn’t change them.",
    ]);
  });

  it("says nothing where no row follows a text style the site has", () => {
    expect(followedStyleWords(BASE, ["body", "heading"], classes)).toEqual([]);
    expect(followedStyleWords(following, ["heading"], undefined)).toEqual([]);
  });
});

describe("refusing to remove the Body or Headings font", () => {
  it("names the role and says to choose another first", () => {
    expect(roleRefusal("Lora", ["body"])).toBe(
      "Lora is your body font. Choose another body font first."
    );
    expect(roleRefusal("Lora", ["heading"])).toBe(
      "Lora is your headings font. Choose another headings font first."
    );
    expect(roleRefusal("Lora", ["body", "heading"])).toBe(
      "Lora is your body and headings font. Choose other body and headings fonts first."
    );
  });

  it("refuses nothing for a font that is neither", () => {
    expect(roleRefusal("Lora", [])).toBeUndefined();
  });
});

describe("what using a new font says", () => {
  it("says which font it now is", () => {
    expect(nowYourFontWords("Inter", ["heading"])).toBe(
      "Inter is now your headings font"
    );
    expect(nowYourFontWords("Inter", ["body"])).toBe(
      "Inter is now your body font"
    );
    expect(nowYourFontWords("Inter", ["body", "heading"])).toBe(
      "Inter is now your body and headings font"
    );
  });
});
