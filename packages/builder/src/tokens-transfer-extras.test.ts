/**
 * What the design-token export and import carry beyond the variables, driven
 * as the Design panel drives them: text styles, Site text, the colour order,
 * the fluid range, the built-in colours setting, and the fonts a file uses
 * that the site lacks.
 *
 * @module tokens-transfer-extras.test
 */
import type {
  FontFaceDef,
  NamedClass,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { DESIGN_ACTION_WORDS } from "./editor-words";
import {
  applyImport,
  exportDtcgWithTheme,
  exportForFigma,
  planImport,
  type ImportPlan,
} from "./tokens-transfer";

const eyebrow: NamedClass = {
  id: "ts-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 2,
  role: "text",
  styles: {
    base: {
      base: {
        fontSize: { $token: "font-size.h2" },
        textTransform: "uppercase",
      },
    },
  },
};

const loose: NamedClass = {
  id: "ts-loose",
  slug: "loose",
  label: "Loose",
  orderIndex: 3,
  role: "text",
  styles: { base: { base: { letterSpacing: "0.1em" } } },
};

/** A block style and a shared style: never in the token file. */
const others: NamedClass[] = [
  {
    id: "look:core/button:outline",
    slug: "button-outline",
    orderIndex: 0,
    blockType: "core/button",
    styles: { base: { base: { borderWidth: "2px" } } },
  },
  {
    id: "c-card",
    slug: "card",
    orderIndex: 1,
    styles: { base: { base: { padding: "1rem" } } },
  },
];

const SITE: SiteTokenSet = {
  tokens: [
    {
      id: "c-brand",
      name: "color.brand",
      label: "Brand",
      kind: "color",
      group: "Brand",
      values: { light: "#336699", dark: "#99bbdd" },
    },
    { name: "font-size.h2", kind: "dimension", values: { light: "1.75rem" } },
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
    {
      name: "shadow.card",
      label: "Card shadow",
      kind: "shadow",
      values: { light: "0 2px 4px var(--site-c-brand)" },
    },
  ],
  siteText: {
    body: { fontFamily: { $token: "font.body" } },
    h2: { textStyle: "ts-eyebrow" },
  },
  order: ["c-brand"],
  fluidRange: { min: 320, max: 1440 },
  builtInColoursShown: false,
};

const brandSans: FontFaceDef = {
  family: "Brand Sans",
  weight: "400",
  style: "normal",
  src: [{ url: "/media/brand-sans.woff2", format: "woff2" }],
};

const files = (set: SiteTokenSet, textStyles: readonly NamedClass[]) =>
  exportDtcgWithTheme(set, textStyles).map(file => ({
    name: file.filename,
    text: file.text,
  }));

const ready = (plan: ImportPlan): Extract<ImportPlan, { ok: true }> => {
  if (!plan.ok) throw new Error(plan.error);
  return plan;
};

describe("the design token export", () => {
  it("writes text styles, and lists one design tools can't read as kept for Nextly", () => {
    const [main] = exportDtcgWithTheme(SITE, [...others, eyebrow, loose]);
    const file = JSON.parse(main?.text ?? "{}") as Record<string, unknown>;
    expect(Object.keys(file.textStyles as object)).toEqual(["eyebrow"]);
    expect(main?.text).not.toContain("button-outline");
    expect(main?.text).not.toContain("c-card");
    expect(main?.gaps).toContainEqual({
      name: "textStyles.loose",
      label: "Loose",
      outcome: "kept",
      why: "Design tools can't read this text style as it is written.",
    });
  });
});

describe("the For Figma export", () => {
  it("writes one file per mode, and lists shadows and text styles as Figma keeps them", () => {
    const made = exportForFigma(SITE, [eyebrow]);
    expect(made.map(file => file.filename)).toEqual([
      "light.tokens.json",
      "dark.tokens.json",
    ]);
    const gaps = made.flatMap(file => file.gaps);
    const why = DESIGN_ACTION_WORDS.figmaStyles;
    expect(why).toBe(
      "Figma keeps these as effect styles and text styles; the variables they use are in the file"
    );
    expect(gaps).toEqual([
      { name: "shadow.card", label: "Card shadow", outcome: "left-out", why },
      {
        name: "textStyles.eyebrow",
        label: "Eyebrow",
        outcome: "left-out",
        why,
      },
    ]);
  });
});

describe("an import carrying the site's own design data", () => {
  const fresh: SiteTokenSet = { tokens: [] };

  it("plans the text styles, the site data and the fonts the site lacks", () => {
    const plan = ready(
      planImport(files(SITE, [eyebrow, loose]), fresh, {
        textStyles: [],
        faces: [],
      })
    );
    expect(plan.extras.textStyles.added.map(style => style.id)).toEqual([
      "ts-eyebrow",
      "ts-loose",
    ]);
    expect(plan.extras.site).toEqual({
      siteText: SITE.siteText,
      order: SITE.order,
      fluidRange: SITE.fluidRange,
      builtInColoursShown: false,
    });
    expect(plan.extras.missingFonts).toEqual(["Brand Sans", "Inter"]);
  });

  it("doesn't list a font the site has, nor a generic family", () => {
    const plan = ready(
      planImport(files(SITE, []), fresh, { textStyles: [], faces: [brandSans] })
    );
    expect(plan.extras.missingFonts).toEqual(["Inter"]);
  });

  it("applies the site data with the variables, and the text styles as one class edit", () => {
    const plan = ready(
      planImport(files(SITE, [eyebrow]), fresh, { textStyles: others })
    );
    const applied = applyImport(plan, fresh, new Map());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.tokens.siteText).toEqual(SITE.siteText);
    expect(applied.tokens.order).toEqual(SITE.order);
    expect(applied.tokens.fluidRange).toEqual(SITE.fluidRange);
    expect(applied.tokens.builtInColoursShown).toBe(false);
    expect(applied.textStyles).toBe(1);
    const edited = applied.classes?.(others);
    expect(edited).toEqual({ classes: [...others, eyebrow] });
  });

  it("keeps the site's rows the file doesn't state, and replaces the ones it does", () => {
    const mine: SiteTokenSet = {
      tokens: [],
      siteText: {
        h1: { fontSize: "3rem" },
        body: { fontSize: "1.125rem" },
      },
    };
    const plan = ready(planImport(files(SITE, []), mine, {}));
    const applied = applyImport(plan, mine, new Map());
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.tokens.siteText).toEqual({
      h1: { fontSize: "3rem" },
      ...SITE.siteText,
    });
  });

  it("updates a text style the site has by its id, and leaves an unchanged one alone", () => {
    const older = {
      ...eyebrow,
      styles: { base: { base: { fontSize: "1rem" } } },
    };
    const plan = ready(
      planImport(files(SITE, [eyebrow, loose]), fresh, {
        textStyles: [older, loose],
      })
    );
    expect(plan.extras.textStyles.updated.map(style => style.id)).toEqual([
      "ts-eyebrow",
    ]);
    expect(plan.extras.textStyles.unchanged.map(style => style.id)).toEqual([
      "ts-loose",
    ]);
    const applied = applyImport(plan, fresh, new Map());
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.classes?.([older, loose])).toEqual({
      classes: [eyebrow, loose],
    });
  });

  it("refuses a text style whose name another text style on the site has, saying so", () => {
    const mine: NamedClass = { ...eyebrow, id: "ts-mine", label: "eyebrow" };
    const plan = ready(
      planImport(files(SITE, [eyebrow]), fresh, { textStyles: [mine] })
    );
    expect(plan.extras.textStyles.added).toEqual([]);
    expect(plan.skipped).toContain(
      "There is already a text style named “eyebrow” on this site, so “Eyebrow” was not imported."
    );
  });

  it("refuses a text style whose id is another kind of style's on the site", () => {
    const shared: NamedClass = { ...others[1], id: "ts-eyebrow" } as NamedClass;
    const plan = ready(
      planImport(files(SITE, [eyebrow]), fresh, { textStyles: [shared] })
    );
    expect(plan.extras.textStyles.added).toEqual([]);
    expect(plan.skipped).toContain(
      "“Eyebrow” was not imported: a style on this site that isn't a text style has the same id."
    );
  });

  it("imports site data alone, when the file holds no variable this site changes", () => {
    const plan = ready(planImport(files(SITE, []), SITE, {}));
    const applied = applyImport(
      plan,
      { ...SITE, fluidRange: { min: 360, max: 1280 } },
      new Map()
    );
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.imported).toBe(0);
    expect(applied.tokens.fluidRange).toEqual(SITE.fluidRange);
  });

  it("says nothing would change when the variables, data and text styles all match", () => {
    const plan = ready(
      planImport(files(SITE, [eyebrow]), SITE, { textStyles: [eyebrow] })
    );
    const applied = applyImport(plan, SITE, new Map());
    expect(applied.ok).toBe(false);
  });

  it("points the file's text styles and Site text at the variable this site holds under a name the file uses", () => {
    // This site renamed its own variable to the code name the file uses, so
    // the import merges into it under the site's id: what the file's text
    // styles and rows name by that code name follows it there.
    const mine: SiteTokenSet = {
      tokens: [
        {
          id: "t-own-h2",
          name: "font-size.h2",
          kind: "dimension",
          values: { light: "2rem" },
        },
      ],
    };
    const source: SiteTokenSet = {
      ...SITE,
      siteText: {
        h2: { fontSize: { $token: "font-size.h2" } },
        h3: { fontSize: "var(--site-font-size-h2)" },
      },
    };
    const plan = ready(
      planImport(files(source, [eyebrow]), mine, { textStyles: [] })
    );
    expect(plan.extras.textStyles.added[0]?.styles).toEqual({
      base: {
        base: { fontSize: { $token: "t-own-h2" }, textTransform: "uppercase" },
      },
    });
    expect(plan.extras.site?.siteText).toEqual({
      h2: { fontSize: { $token: "t-own-h2" } },
      h3: { fontSize: "var(--site-t-own-h2)" },
    });
  });

  it("follows only the whole custom property of a merged variable, never one it begins", () => {
    const mine: SiteTokenSet = {
      tokens: [
        {
          id: "t-own-h2",
          name: "font-size.h2",
          kind: "dimension",
          values: { light: "2rem" },
        },
      ],
    };
    const source: SiteTokenSet = {
      ...SITE,
      tokens: [
        ...SITE.tokens,
        {
          name: "font-size.h2-large",
          kind: "dimension",
          values: { light: "2.5rem" },
        },
      ],
      siteText: {
        h2: { fontSize: "var(--site-font-size-h2-large)" },
        h3: { fontSize: "var(--site-font-size-h2, 1rem)" },
        h4: { fontSize: "calc(var(--site-font-size-h2) * 1.2)" },
      },
    };
    const plan = ready(planImport(files(source, []), mine, { textStyles: [] }));
    expect(plan.extras.site?.siteText).toEqual({
      h2: { fontSize: "var(--site-font-size-h2-large)" },
      h3: { fontSize: "var(--site-t-own-h2, 1rem)" },
      h4: { fontSize: "calc(var(--site-t-own-h2) * 1.2)" },
    });
  });

  it("keeps this site's Site text row where the file's follows a text style that wasn't imported, saying so", () => {
    const mine: NamedClass = { ...eyebrow, id: "ts-mine" };
    const into: SiteTokenSet = {
      tokens: [],
      siteText: { h2: { fontSize: "2rem" } },
    };
    const plan = ready(
      planImport(files(SITE, [eyebrow]), into, { textStyles: [mine] })
    );
    expect(plan.extras.site?.siteText).toEqual({
      body: SITE.siteText?.body,
    });
    expect(plan.skipped).toContain(
      "Site text: Heading 2 kept this site's own settings, because the text style it follows in the file, “Eyebrow”, wasn't imported."
    );
    const applied = applyImport(plan, into, new Map());
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.tokens.siteText?.h2).toEqual({ fontSize: "2rem" });
  });

  it("imports a text style locked on its own site unlocked, since a lock is set on each site", () => {
    const locked: NamedClass = { ...eyebrow, locked: true };
    const plan = ready(
      planImport(files(SITE, [locked]), fresh, { textStyles: others })
    );
    expect(plan.extras.textStyles.added).toEqual([eyebrow]);
    const applied = applyImport(plan, fresh, new Map());
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.classes?.(others)).toEqual({
      classes: [...others, eyebrow],
    });
  });

  it("leaves a text style locked on this site as it is, saying so, and keeps a lock off where it is off", () => {
    const changed: NamedClass = {
      ...eyebrow,
      locked: true,
      styles: { base: { base: { fontSize: "2rem" } } },
    };
    const mine: NamedClass = { ...eyebrow, locked: true };
    const refused = ready(
      planImport(files(SITE, [changed]), fresh, { textStyles: [mine] })
    );
    expect(refused.extras.textStyles.updated).toEqual([]);
    expect(refused.skipped).toContain(
      "“Eyebrow” is locked on this site, so the file's version was not imported. Unlock it first."
    );
    // An unlocked one on this site takes the file's styles and stays
    // unlocked.
    const updated = ready(
      planImport(files(SITE, [changed]), fresh, { textStyles: [eyebrow] })
    );
    expect(updated.extras.textStyles.updated).toEqual([
      { ...eyebrow, styles: changed.styles },
    ]);
  });

  it("brings in no text styles where nothing can store them, saying so", () => {
    const plan = ready(planImport(files(SITE, [eyebrow, loose]), fresh, {}));
    expect(plan.extras.textStyles).toEqual({
      added: [],
      updated: [],
      unchanged: [],
    });
    expect(plan.skipped).toContain(
      "The file's 2 text styles weren't imported: text styles can only be imported from the editor's Design panel."
    );
    const applied = applyImport(plan, fresh, new Map());
    if (!applied.ok) throw new Error(applied.error);
    expect(applied.classes).toBeUndefined();
    expect(applied.textStyles ?? 0).toBe(0);
  });

  it("refuses a text style whose code name a shared style on this site already writes", () => {
    const card = others[1] as NamedClass;
    const named: NamedClass = { ...eyebrow, slug: card.slug };
    const plan = ready(
      planImport(files(SITE, [named]), fresh, { textStyles: others })
    );
    expect(plan.extras.textStyles.added).toEqual([]);
    expect(plan.skipped).toContain(
      "“Eyebrow” was not imported: a style on this site already uses its code name, “card”."
    );
  });

  it("leaves out a text style's values for a breakpoint this site doesn't have, saying so", () => {
    const responsive: NamedClass = {
      ...eyebrow,
      styles: {
        base: {
          base: { fontSize: "1rem" },
          wide: { fontSize: "1.5rem" },
          tablet: { fontSize: "0.875rem" },
        },
      },
    };
    const plan = ready(
      planImport(files(SITE, [responsive]), fresh, {
        textStyles: others,
        breakpoints: {
          viewport: [
            { id: "base", label: "Desktop" },
            { id: "tablet", label: "Tablet", maxWidth: 1024 },
          ],
          container: [],
        },
      })
    );
    expect(plan.extras.textStyles.added).toEqual([
      {
        ...eyebrow,
        styles: {
          base: {
            base: { fontSize: "1rem" },
            tablet: { fontSize: "0.875rem" },
          },
        },
      },
    ]);
    expect(plan.skipped).toContain(
      "“Eyebrow”'s values for the “wide” breakpoint were left out: this site has no such breakpoint."
    );
  });
});
