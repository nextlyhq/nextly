/**
 * Light and dark across files: the DTCG theme (resolver) file, the "For Figma"
 * export of one file per mode, and an import of Figma's own export.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RESOLVER_VERSION,
  modeFilesToTokens,
  resolverToTokens,
  tokensToFigma,
  tokensToResolver,
} from "./dtcg-modes";
import { tokensToDtcg } from "./dtcg";
import type { SiteTokenSet } from "./site-tokens";

const SET: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      label: "Brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
    {
      name: "font.body",
      kind: "fontFamily",
      values: { light: '"Inter Tight", system-ui, sans-serif' },
    },
    {
      name: "shadow.card",
      kind: "shadow",
      values: { light: "0 1px 2px rgba(0, 0, 0, 0.1)" },
    },
  ],
};

describe("the theme (resolver) file", () => {
  it("declares the format's version and a theme modifier with light and dark", () => {
    const { resolver } = tokensToResolver(SET, "site.tokens.json");
    expect(resolver.version).toBe(RESOLVER_VERSION);
    expect(RESOLVER_VERSION).toBe("2025.10");
    const theme = (
      resolver.modifiers as Record<string, Record<string, unknown>>
    ).theme;
    expect(theme?.default).toBe("light");
    expect(Object.keys(theme?.contexts as object)).toEqual(["light", "dark"]);
  });

  it("carries only the dark values, inline, in the dark context", () => {
    const { resolver } = tokensToResolver(SET, "site.tokens.json");
    expect(JSON.stringify(resolver)).toContain("#8fa7ff");
    expect(JSON.stringify(resolver)).not.toContain("1rem");
  });

  it("round-trips light and dark through a plain token file and its theme", () => {
    // A file from another tool: no nextly extension, so dark can only come
    // from the theme file.
    const plain: SiteTokenSet = {
      tokens: SET.tokens
        .slice(0, 2)
        .map(({ label: _label, ...token }) => token),
    };
    const base = tokensToDtcg({
      tokens: plain.tokens.map(t => ({
        ...t,
        values: { light: t.values.light },
      })),
    }).document;
    stripNextly(base);
    const { resolver } = tokensToResolver(plain, "base.tokens.json");
    const back = resolverToTokens(
      resolver,
      new Map([["base.tokens.json", base]])
    );
    expect(back.issues).toEqual([]);
    expect(back.tokens.find(t => t.name === "color.brand")?.values).toEqual({
      light: "#1d2b6b",
      dark: "#8fa7ff",
    });
    expect(back.tokens.find(t => t.name === "space.4")?.values).toEqual({
      light: "1rem",
    });
  });

  it("keeps each dark shadow layer's colour variable when the files come back unedited", () => {
    const set: SiteTokenSet = {
      tokens: [
        {
          name: "color.brand",
          kind: "color",
          values: { light: "#336699", dark: "#99bbdd" },
        },
        {
          name: "color.ink",
          kind: "color",
          values: { light: "#111111", dark: "#eeeeee" },
        },
        {
          name: "shadow.card",
          kind: "shadow",
          values: {
            light: "0 1px 2px var(--site-color-brand)",
            dark: "0 2px 4px var(--site-color-brand)",
          },
        },
        {
          name: "shadow.raised",
          kind: "shadow",
          values: {
            light:
              "0 1px 2px var(--site-color-brand), inset 0 4px 8px 1px var(--site-color-ink)",
            dark: "0 2px 4px var(--site-color-ink), 0 8px 16px var(--site-color-brand)",
          },
        },
      ],
    };
    const file = tokensToDtcg(set).document;
    const { resolver } = tokensToResolver(set, "site.tokens.json");
    const back = resolverToTokens(
      resolver,
      new Map([["site.tokens.json", JSON.parse(JSON.stringify(file))]])
    );
    expect(back.issues).toEqual([]);
    // Every variable comes back exactly, light and dark, each shadow layer
    // still naming its colour variable.
    expect(back.tokens).toEqual(set.tokens);
  });

  it("reads the token file's text styles and site data through its theme file", () => {
    const withExtras: SiteTokenSet = {
      ...SET,
      siteText: { body: { fontFamily: { $token: "font.body" } } },
      fluidRange: { min: 320, max: 1440 },
    };
    const eyebrow = {
      id: "ts-eyebrow",
      slug: "eyebrow",
      orderIndex: 0,
      role: "text" as const,
      styles: { base: { base: { fontSize: "0.75rem" } } },
    };
    const file = tokensToDtcg(withExtras, { textStyles: [eyebrow] }).document;
    const { resolver } = tokensToResolver(withExtras, "site.tokens.json");
    const back = resolverToTokens(
      resolver,
      new Map([["site.tokens.json", JSON.parse(JSON.stringify(file))]])
    );
    expect(back.issues).toEqual([]);
    expect(back.site).toEqual({
      siteText: withExtras.siteText,
      fluidRange: withExtras.fluidRange,
    });
    expect(back.textStyles).toEqual([eyebrow]);
  });

  it("names a source file it was not given", () => {
    const { resolver } = tokensToResolver(SET, "site.tokens.json");
    const back = resolverToTokens(resolver, new Map());
    expect(back.issues.map(i => i.message).join(" ")).toMatch(
      /site\.tokens\.json/
    );
  });
});

describe("the For Figma export, one file per mode", () => {
  it("writes px dimensions, sRGB with hex, and one font family", () => {
    const light = tokensToFigma(SET, "light").document as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(light.color?.brand?.$value).toEqual({
      colorSpace: "srgb",
      components: [29 / 255, 43 / 255, 107 / 255],
      alpha: 1,
      hex: "#1D2B6B",
    });
    expect(light.space?.["4"]?.$value).toEqual({ value: 16, unit: "px" });
    expect(light.font?.body?.$value).toBe("Inter Tight");
  });

  it("puts every token in both files, dark falling back to light", () => {
    const light = tokensToFigma(SET, "light");
    const dark = tokensToFigma(SET, "dark");
    expect(paths(dark.document)).toEqual(paths(light.document));
    const doc = dark.document as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect((doc.color?.brand?.$value as { hex: string }).hex).toBe("#8FA7FF");
    expect(doc.space?.["4"]?.$value).toEqual({ value: 16, unit: "px" });
  });

  it("leaves out a family list that reads another property, saying so", () => {
    // `var(--brand-font)` is not a family name, so writing it as one would
    // hand Figma a font that does not exist.
    const made = tokensToFigma(
      {
        tokens: [
          {
            name: "font.brand",
            kind: "fontFamily",
            values: { light: "var(--brand-font), sans-serif" },
          },
        ],
      },
      "light"
    );
    expect(made.document).toEqual({});
    expect(made.issues.map(i => i.message).join(" ")).toMatch(/font\.brand/);
  });

  it("leaves out a variable whose name cannot be written, as the DTCG export does", () => {
    const made = tokensToFigma(
      {
        tokens: [{ name: "bad}", kind: "color", values: { light: "#000000" } }],
      },
      "light"
    );
    expect(made.document).toEqual({});
    expect(made.issues.map(i => i.message).join(" ")).toMatch(/bad\}/);
  });

  it("says it is the id that cannot be written, when it is", () => {
    const made = tokensToFigma(
      {
        tokens: [
          {
            id: "bad}",
            name: "color.ink",
            kind: "color",
            values: { light: "#000000" },
          },
        ],
      },
      "light"
    );
    expect(made.document).toEqual({});
    expect(made.issues.map(i => i.message).join(" ")).toMatch(
      /"color\.ink" has an id that is not a token name/
    );
  });

  it("leaves out what Figma cannot hold, from both files, and says so", () => {
    const light = tokensToFigma(SET, "light");
    expect(paths(light.document)).not.toContain("shadow.card");
    expect(light.issues.map(i => i.message).join(" ")).toMatch(/shadow\.card/);
  });
});

describe("an import of Figma's own export", () => {
  // Built from the format Figma documents for its DTCG variables export and
  // import (Figma Help Center, "Import and export variables", article
  // 15343816063383): one file per mode, sRGB colours with `hex`, px
  // dimensions, durations in seconds, a single font family, whole-token
  // aliases, `com.figma.*` keys in `$extensions`, Figma's own `string` type,
  // read as a custom value, and boolean numbers, which this site has no kind for.
  const read = (mode: string): unknown =>
    JSON.parse(
      readFileSync(
        new URL(`./fixtures/figma-${mode}.tokens.json`, import.meta.url),
        "utf8"
      )
    ) as unknown;

  it("reads light and dark from the two files, aliases resolved", () => {
    const { tokens, issues } = modeFilesToTokens([
      { name: "Light.tokens.json", document: read("Light") },
      { name: "Dark.tokens.json", document: read("Dark") },
    ]);
    const brand = tokens.find(t => t.name === "color.brand");
    expect(brand?.values).toEqual({ light: "#1D2B6B", dark: "#8FA7FF" });
    expect(tokens.find(t => t.name === "color.background")?.values).toEqual({
      light: "#FFFFFF",
      dark: "#111318",
    });
    expect(tokens.find(t => t.name === "space.md")?.values).toEqual({
      light: "16px",
    });
    expect(tokens.find(t => t.name === "font.body")?.values.light).toBe(
      "Inter"
    );
    // Figma's own keys are another vendor's data, and travel with the token.
    expect(brand?.extensions?.["com.figma.variableId"]).toBe("VariableID:1:4");
    // A string variable is a custom value: the text it holds.
    expect(tokens.find(t => t.name === "copy.cta")).toMatchObject({
      kind: "custom",
      values: { light: "Start free" },
    });
    const said = issues.map(i => i.message).join(" ");
    expect(said).not.toMatch(/copy\.cta/);
    expect(said).toMatch(/flags\.rounded/);
    expect(tokens.map(t => t.name)).not.toContain("flags.rounded");
  });

  it("tells the modes apart by file name, whichever order they arrive in", () => {
    const { tokens } = modeFilesToTokens([
      { name: "Dark.tokens.json", document: read("Dark") },
      { name: "Light.tokens.json", document: read("Light") },
    ]);
    expect(tokens.find(t => t.name === "color.brand")?.values).toEqual({
      light: "#1D2B6B",
      dark: "#8FA7FF",
    });
  });

  it("skips a dark value whose kind differs from the light one, saying so", () => {
    const colour = {
      $type: "color",
      $value: { colorSpace: "srgb", components: [1, 0, 0], hex: "#FF0000" },
    };
    const { tokens, issues } = modeFilesToTokens([
      { name: "Light.tokens.json", document: { accent: colour } },
      {
        name: "Dark.tokens.json",
        document: {
          accent: { $type: "dimension", $value: { value: 16, unit: "px" } },
        },
      },
    ]);
    expect(tokens).toEqual([
      { name: "accent", kind: "color", values: { light: "#FF0000" } },
    ]);
    expect(issues.map(i => i.message).join(" ")).toMatch(
      /"accent" is a color in the light file and a dimension in the dark file/
    );
  });

  it("refuses more than two mode files rather than reading two of them", () => {
    const { tokens, issues } = modeFilesToTokens([
      { name: "Light.tokens.json", document: read("Light") },
      { name: "Dark.tokens.json", document: read("Dark") },
      { name: "Contrast.tokens.json", document: read("Light") },
    ]);
    expect(tokens).toEqual([]);
    expect(issues.map(i => i.message).join(" ")).toMatch(
      /3 files.*one for light and one for dark/
    );
  });

  it("reports a second file whose mode its name does not say, rather than dropping it", () => {
    const { tokens, issues } = modeFilesToTokens([
      { name: "Light.tokens.json", document: read("Light") },
      { name: "Contrast.tokens.json", document: read("Dark") },
    ]);
    expect(tokens.find(t => t.name === "color.brand")?.values).toEqual({
      light: "#1D2B6B",
    });
    expect(issues.map(i => i.message).join(" ")).toMatch(
      /Contrast\.tokens\.json.*light or dark/
    );
  });

  it("reports a file whose name says both light and dark, rather than dropping the other", () => {
    const { tokens, issues } = modeFilesToTokens([
      { name: "light-dark.tokens.json", document: read("Light") },
      { name: "contrast.tokens.json", document: read("Dark") },
    ]);
    expect(tokens).toEqual([]);
    expect(issues.map(i => i.message).join(" ")).toMatch(
      /light-dark\.tokens\.json.*both/
    );
  });

  it("reads one file alone as light", () => {
    const { tokens } = modeFilesToTokens([
      { name: "Light.tokens.json", document: read("Light") },
    ]);
    expect(tokens.find(t => t.name === "color.brand")?.values).toEqual({
      light: "#1D2B6B",
    });
  });
});

/** Every token path in a document, dot-joined. */
function paths(node: unknown, at: string[] = []): string[] {
  if (typeof node !== "object" || node === null) return [];
  if ("$value" in node) return [at.join(".")];
  return Object.entries(node).flatMap(([key, child]) =>
    key.startsWith("$") ? [] : paths(child, [...at, key])
  );
}

/** Remove this system's own extension, as another tool's file would lack it. */
function stripNextly(node: unknown): void {
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  const ext = record.$extensions as Record<string, unknown> | undefined;
  if (ext !== undefined) {
    delete ext["com.nextlyhq.nextly"];
    if (Object.keys(ext).length === 0) delete record.$extensions;
  }
  for (const [key, child] of Object.entries(record)) {
    if (!key.startsWith("$")) stripNextly(child);
  }
}

describe("every variable through the theme file and the Figma files", () => {
  const FLUID = "clamp(1rem, 0.5rem + 2vw, 2rem)";
  const FLUID_DARK = "clamp(1rem, 0.5rem + 3vw, 3rem)";
  const WIDE: SiteTokenSet = {
    tokens: [
      {
        name: "space.hero",
        kind: "dimension",
        values: { light: FLUID, dark: FLUID_DARK },
      },
      {
        name: "shadow.card",
        kind: "shadow",
        values: {
          light: "0 1px 2px rgb(0 0 0 / 0.1)",
          dark: "0 1px 2px rgb(0 0 0 / 0.6)",
        },
      },
      { name: "misc.ratio", kind: "custom", values: { light: "16 / 9" } },
      {
        name: "color.brand",
        kind: "color",
        values: { light: "rgb(29 43 107)", dark: "rgb(143 167 255)" },
      },
    ],
  };

  it("restores every exact value, light and dark, from the token file and its theme", () => {
    const base = JSON.parse(
      JSON.stringify(tokensToDtcg(WIDE).document)
    ) as Record<string, unknown>;
    const { resolver } = tokensToResolver(WIDE, "variables.tokens.json");
    const back = resolverToTokens(
      JSON.parse(JSON.stringify(resolver)),
      new Map([["variables.tokens.json", base]])
    );
    expect(back.issues).toEqual([]);
    // The theme file holds the dark values the format can type, converted; the
    // token file's extension holds every one exactly, and that one is kept.
    const sorted = (list: readonly { name: string }[]) =>
      [...list].sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted(back.tokens)).toEqual(sorted(WIDE.tokens));
  });

  it("keeps the theme file to what a reader of the standard can use", () => {
    const { resolver } = tokensToResolver(WIDE, "variables.tokens.json");
    const text = JSON.stringify(resolver);
    expect(text).not.toContain("com.nextlyhq.nextly");
    expect(text).not.toContain("16 / 9");
  });

  it("writes a custom value as a Figma string variable", () => {
    const light = tokensToFigma(WIDE, "light").document as Record<
      string,
      Record<string, unknown>
    >;
    expect(light.misc?.ratio).toEqual({ $type: "string", $value: "16 / 9" });
  });

  it("writes a fluid size as its largest px value in each mode", () => {
    const value = (mode: "light" | "dark") =>
      (
        tokensToFigma(WIDE, mode).document as Record<
          string,
          Record<string, Record<string, unknown>>
        >
      ).space?.hero?.$value;
    expect(value("light")).toEqual({ value: 32, unit: "px" });
    expect(value("dark")).toEqual({ value: 48, unit: "px" });
  });

  it("says Figma keeps shadows as effect styles, not variables", () => {
    const light = tokensToFigma(WIDE, "light");
    expect(paths(light.document)).not.toContain("shadow.card");
    expect(light.issues.map(i => i.message).join(" ")).toContain(
      "Figma keeps shadows as effect styles, not variables"
    );
  });
});

describe("the theme file beside variables the format types in one mode only", () => {
  const MIXED: SiteTokenSet = {
    tokens: [
      // Light the format cannot type, dark it can: carried in the token file,
      // written as a token in the theme file.
      {
        name: "space.x",
        kind: "dimension",
        values: { light: "1em", dark: "16px" },
      },
      {
        name: "color.mixed",
        kind: "color",
        values: { light: "color-mix(in srgb, red 50%, blue)", dark: "#112233" },
      },
      {
        name: "color.edited",
        kind: "color",
        values: { light: "#ffffff", dark: "#000000" },
      },
    ],
  };
  const files = () => {
    const base = JSON.parse(JSON.stringify(tokensToDtcg(MIXED).document));
    const { resolver } = tokensToResolver(MIXED, "variables.tokens.json");
    return { base, resolver: JSON.parse(JSON.stringify(resolver)) };
  };
  const sorted = (list: readonly { name: string }[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name));

  it("imports cleanly, every value exact, with nothing said twice", () => {
    const { base, resolver } = files();
    const back = resolverToTokens(
      resolver,
      new Map([["variables.tokens.json", base]])
    );
    expect(back.issues).toEqual([]);
    expect(sorted(back.tokens)).toEqual(sorted(MIXED.tokens));
  });

  it("reads the carried variables a dark source file supplies itself", () => {
    // A theme file of another arrangement: separate light and dark token
    // files, each exported from here, so each carries its own `em` value.
    const one = (light: string) =>
      JSON.parse(
        JSON.stringify(
          tokensToDtcg({
            tokens: [
              { name: "space.gap", kind: "dimension", values: { light } },
            ],
          }).document
        )
      );
    const resolver = {
      version: "2025.10",
      sets: { base: { sources: [{ $ref: "light.tokens.json" }] } },
      modifiers: {
        theme: {
          contexts: { light: [], dark: [{ $ref: "dark.tokens.json" }] },
          default: "light",
        },
      },
      resolutionOrder: [{ $ref: "#/sets/base" }, { $ref: "#/modifiers/theme" }],
    };
    const back = resolverToTokens(
      resolver,
      new Map([
        ["light.tokens.json", one("1em")],
        ["dark.tokens.json", one("2em")],
      ])
    );
    expect(back.issues).toEqual([]);
    expect(back.tokens).toEqual([
      {
        name: "space.gap",
        kind: "dimension",
        values: { light: "1em", dark: "2em" },
      },
    ]);
  });

  it("takes a dark value edited in the theme file", () => {
    const { base, resolver } = files();
    const dark = (
      (resolver.modifiers.theme.contexts.dark as Record<string, unknown>[])[0]
        ?.color as Record<string, Record<string, unknown>>
    ).edited;
    if (dark === undefined) throw new Error("the theme file lost color.edited");
    dark.$value = { colorSpace: "srgb", components: [1, 0, 0], hex: "#ff0000" };
    const back = resolverToTokens(
      resolver,
      new Map([["variables.tokens.json", base]])
    );
    expect(
      back.tokens.find(token => token.name === "color.edited")?.values.dark
    ).toBe("#ff0000");
  });
});

describe("Nextly's own Figma files, imported back", () => {
  it("reads a custom value back from its string variable", () => {
    const set: SiteTokenSet = {
      tokens: [
        { name: "misc.ratio", kind: "custom", values: { light: "16 / 9" } },
      ],
    };
    const back = modeFilesToTokens([
      {
        name: "light.tokens.json",
        document: tokensToFigma(set, "light").document,
      },
      {
        name: "dark.tokens.json",
        document: tokensToFigma(set, "dark").document,
      },
    ]);
    expect(back.issues).toEqual([]);
    expect(back.tokens).toEqual(set.tokens);
  });
});
