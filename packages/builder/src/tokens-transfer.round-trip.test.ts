/**
 * A site's design, exported and imported into a fresh site, comes back the
 * same.
 *
 * The fixture site has one variable of each kind, dark values, a colour
 * group and order, a fluid size with its two sizes and a changed fluid
 * range, a two-layer shadow coloured by a colour variable, text styles,
 * Site text rows (one following a text style), the Body and Headings fonts,
 * a font file it uploaded, and a block style and a shared style of its own.
 *
 * What the file carries is compared: the variable blocks of the shared CSS
 * byte for byte, light and dark, and each Site text row's and each text
 * style's declarations (a text style matched by name). Font files are not in
 * the file (fonts travel by name), so the import lists the uploaded font as
 * missing; block styles and shared styles are not design tokens, so the
 * file leaves them out.
 *
 * @module tokens-transfer.round-trip.test
 */
import {
  compileSiteSheet,
  emitTokenBlocks,
  resolveSiteText,
  resolveSiteTokens,
  SITE_TEXT_ROLES,
  siteTextElementBases,
  siteTextStyles,
  textStylesOf,
  type FontFaceDef,
  type NamedClass,
  type SiteToken,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  applyImport,
  exportDtcgWithTheme,
  planImport,
} from "./tokens-transfer";

const OVERRIDES: SiteToken[] = [
  {
    name: "color.primary",
    kind: "color",
    group: "Brand",
    values: { light: "#1d4ed8", dark: "#93c5fd" },
    description: "Buttons and links.",
  },
  {
    id: "c-accent",
    name: "color.accent",
    label: "Accent",
    kind: "color",
    group: "Brand",
    values: { light: "#db2777", dark: "#f9a8d4" },
  },
  {
    name: "space.hero",
    label: "Hero",
    kind: "dimension",
    fluid: { small: 32, large: 64 },
    values: { light: "clamp(2rem, 1.1071rem + 2.8571vw, 4rem)" },
  },
  { name: "space.lead", kind: "dimension", values: { light: "1.5em" } },
  { name: "weight.heavy", kind: "fontWeight", values: { light: "800" } },
  { name: "ratio.golden", kind: "number", values: { light: "1.618" } },
  { name: "motion.slow", kind: "duration", values: { light: "400ms" } },
  {
    name: "shadow.lift",
    label: "Lift",
    kind: "shadow",
    values: {
      light: "0 1px 2px rgb(0 0 0 / 0.2), 0 8px 24px var(--site-c-accent)",
      dark: "0 1px 2px #000000, 0 8px 24px var(--site-c-accent)",
    },
  },
  { name: "misc.ratio", kind: "custom", values: { light: "16 / 9" } },
  {
    name: "font.body",
    kind: "fontFamily",
    values: { light: '"Brand Sans", sans-serif' },
  },
  {
    name: "font.heading",
    kind: "fontFamily",
    values: { light: "Inter, sans-serif" },
  },
];

const TEXT_STYLES: NamedClass[] = [
  {
    id: "ts-eyebrow",
    slug: "eyebrow",
    label: "Eyebrow",
    orderIndex: 2,
    role: "text",
    styles: {
      base: {
        base: {
          fontSize: { $token: "font-size.small" },
          fontWeight: { $token: "weight.heavy" },
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        },
        mobile: { fontSize: "0.75rem" },
      },
    },
  },
  {
    id: "ts-display",
    slug: "display",
    label: "Display",
    orderIndex: 3,
    role: "text",
    styles: {
      base: {
        base: {
          fontFamily: { $token: "font.heading" },
          fontSize: { $token: "font-size.h1" },
          lineHeight: { $token: "line-height.h1" },
        },
      },
    },
  },
];

/** The site's own block style and shared style: not design tokens. */
const OTHER_CLASSES: NamedClass[] = [
  {
    id: "look:core/button:pill",
    slug: "button-pill",
    label: "Pill",
    orderIndex: 0,
    blockType: "core/button",
    styles: { base: { base: { borderRadius: "999px" } } },
  },
  {
    id: "c-card",
    slug: "card",
    label: "Card",
    orderIndex: 1,
    styles: { base: { base: { boxShadow: { $token: "shadow.lift" } } } },
  },
];

const FIRST: SiteTokenSet = {
  ...resolveSiteTokens({ tokens: OVERRIDES }),
  siteText: {
    body: { fontFamily: { $token: "font.body" } },
    h2: {
      fontFamily: { $token: "font.heading" },
      fontSize: { $token: "font-size.h2" },
      lineHeight: { $token: "line-height.h2" },
    },
    h3: { textStyle: "ts-eyebrow" },
    link: { color: { $token: "c-accent" }, underline: "hover" },
  },
  order: ["c-accent", "color.primary"],
  fluidRange: { min: 320, max: 1440 },
  builtInColoursShown: false,
};

const FIRST_CLASSES = [...OTHER_CLASSES, ...TEXT_STYLES];

/** The font file the first site uploaded. */
const UPLOADED: FontFaceDef = {
  family: "Brand Sans",
  weight: "400",
  style: "normal",
  src: [{ url: "/media/brand-sans.woff2", format: "woff2" }],
};

const BREAKPOINTS = {
  viewport: [{ id: "mobile", label: "Mobile", maxWidth: 767 }],
  container: [],
};

/** The fresh site: nothing stored, so the engine's defaults alone. */
const FRESH: SiteTokenSet = resolveSiteTokens({ tokens: [] });

/** Export from the first site, import into the fresh one. */
function roundTrip() {
  const files = exportDtcgWithTheme(FIRST, FIRST_CLASSES).map(file => ({
    name: file.filename,
    text: file.text,
  }));
  const plan = planImport(files, FRESH, { textStyles: [], faces: [] });
  if (!plan.ok) throw new Error(plan.error);
  const applied = applyImport(plan, FRESH, new Map());
  if (!applied.ok) throw new Error(applied.error);
  const edited = applied.classes?.([]);
  if (edited === undefined || "reason" in edited) {
    throw new Error("The text styles were not stored.");
  }
  return { files, plan, tokens: applied.tokens, classes: edited.classes };
}

/** The rules of a sheet that name one class. */
function rulesFor(css: string, className: string): string[] {
  return css
    .split("}")
    .filter(rule => rule.includes(`.${className}`))
    .map(rule => rule.trim());
}

describe("a site's design exported and imported into a fresh site", () => {
  it("restores every variable: names, code names, kinds, light and dark values, descriptions, groups and fluid sizes", () => {
    const { tokens } = roundTrip();
    const byIdentity = (set: SiteTokenSet) =>
      [...resolveSiteTokens(set).tokens].sort((a, b) =>
        (a.id ?? a.name).localeCompare(b.id ?? b.name)
      );
    expect(byIdentity(tokens)).toEqual(byIdentity(FIRST));
  });

  it("writes the same variable blocks, light and dark, byte for byte", () => {
    const { tokens } = roundTrip();
    const blocks = (set: SiteTokenSet) =>
      emitTokenBlocks(resolveSiteTokens(set), ":root").css;
    expect(blocks(tokens)).toBe(blocks(FIRST));
    expect(blocks(tokens)).toContain("prefers-color-scheme:dark");
  });

  it("restores the colour order, the fluid range, the built-in colours setting and Site text", () => {
    const { tokens } = roundTrip();
    expect(tokens.order).toEqual(FIRST.order);
    expect(tokens.fluidRange).toEqual(FIRST.fluidRange);
    expect(tokens.builtInColoursShown).toBe(false);
    expect(tokens.siteText).toEqual(FIRST.siteText);
  });

  it("writes the same declarations for each Site text row", () => {
    const { tokens, classes } = roundTrip();
    for (const role of SITE_TEXT_ROLES) {
      expect(
        siteTextStyles(
          role,
          resolveSiteText(tokens.siteText)[role],
          textStylesOf(classes)
        )
      ).toEqual(
        siteTextStyles(
          role,
          resolveSiteText(FIRST.siteText)[role],
          textStylesOf(FIRST_CLASSES)
        )
      );
    }
  });

  it("writes the same declarations for each text style, matched by name", () => {
    const { tokens, classes } = roundTrip();
    const sheet = (set: SiteTokenSet, library: readonly NamedClass[]) =>
      compileSiteSheet(
        {
          tokens: set,
          classes: library,
          blockBases: siteTextElementBases(set.siteText, library),
          breakpoints: BREAKPOINTS,
        },
        {}
      ).css;
    const before = sheet(FIRST, FIRST_CLASSES);
    const after = sheet(tokens, classes);
    for (const style of TEXT_STYLES) {
      const imported = classes.find(entry => entry.label === style.label);
      expect(imported).toBeDefined();
      const rules = rulesFor(after, `nx-t-${imported?.slug ?? ""}`);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules).toEqual(rulesFor(before, `nx-t-${style.slug}`));
    }
  });

  it("lists the font the first site uploaded as missing on the fresh one", () => {
    const { plan } = roundTrip();
    expect(plan.extras.missingFonts).toContain("Brand Sans");
    // The first site has the file, so its own import lists nothing of it.
    const own = planImport(roundTrip().files, FIRST, {
      textStyles: FIRST_CLASSES,
      faces: [UPLOADED],
    });
    if (!own.ok) throw new Error(own.error);
    expect(own.extras.missingFonts).not.toContain("Brand Sans");
  });

  it("leaves the block style and the shared style out of the file", () => {
    const { files, classes } = roundTrip();
    const text = files.map(file => file.text).join("\n");
    expect(text).not.toContain("button-pill");
    expect(text).not.toContain("c-card");
    expect(classes.map(entry => entry.id)).toEqual([
      "ts-eyebrow",
      "ts-display",
    ]);
  });
});
