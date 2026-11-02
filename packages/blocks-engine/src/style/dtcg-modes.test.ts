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
  // aliases, `com.figma.*` keys in `$extensions`, and Figma's own `string` type
  // and boolean numbers, which this site has no kind for.
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
    const said = issues.map(i => i.message).join(" ");
    expect(said).toMatch(/copy\.cta/);
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
