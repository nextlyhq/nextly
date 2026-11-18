/**
 * Shadows in the design-token file: a DTCG `shadow` value where the CSS reads
 * as fields, a colour variable written as an alias, and Nextly-only data
 * otherwise. Read back exactly by this system, and read as CSS from a file
 * another tool wrote.
 */
import { describe, expect, it } from "vitest";

import {
  NEXTLY_EXTENSION,
  dtcgToTokens,
  tokensToDtcg,
  type DtcgNode,
} from "./dtcg";
import type { SiteToken } from "./site-tokens";

const shadow = (name: string, light: string, dark?: string): SiteToken => ({
  name,
  kind: "shadow",
  values: dark === undefined ? { light } : { light, dark },
});

const brand: SiteToken = {
  name: "color.brand",
  kind: "color",
  values: { light: "#336699" },
};

/** The token a written file holds at a dot path. */
function at(document: DtcgNode, name: string): DtcgNode | undefined {
  let node: unknown = document;
  for (const segment of name.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as DtcgNode)[segment];
  }
  return node as DtcgNode | undefined;
}

/** The variables the file keeps only in Nextly's own extension, by name. */
function carried(document: DtcgNode): string[] {
  const own = (document.$extensions as DtcgNode | undefined)?.[
    NEXTLY_EXTENSION
  ] as DtcgNode | undefined;
  return Object.keys((own?.variables as DtcgNode | undefined) ?? {});
}

const px = (value: number) => ({ value, unit: "px" });

describe("a shadow in the design-token file", () => {
  it("writes one layer as a DTCG shadow value: colour, offsets, blur, spread and inset", () => {
    const { document, issues } = tokensToDtcg({
      tokens: [shadow("shadow.card", "0 4px 8px rgb(0 0 0 / 0.25)")],
    });
    expect(issues).toEqual([]);
    const card = at(document, "shadow.card");
    expect(card?.$type).toBe("shadow");
    expect(card?.$value).toEqual({
      color: {
        colorSpace: "srgb",
        components: [0, 0, 0],
        hex: "#000000",
        alpha: 0.25,
      },
      offsetX: px(0),
      offsetY: px(4),
      blur: px(8),
      spread: px(0),
      inset: false,
    });
    expect(carried(document)).toEqual([]);
  });

  it("writes two layers as a list, each with its own parts", () => {
    const { document } = tokensToDtcg({
      tokens: [
        shadow("shadow.deep", "0 1px 2px #000000, 0 8px 16px 2px #ff0000"),
      ],
    });
    const value = at(document, "shadow.deep")?.$value as DtcgNode[];
    expect(value).toHaveLength(2);
    expect(value[0]).toMatchObject({
      offsetY: px(1),
      blur: px(2),
      spread: px(0),
      inset: false,
    });
    expect(value[1]).toMatchObject({
      color: { hex: "#ff0000" },
      offsetY: px(8),
      blur: px(16),
      spread: px(2),
    });
  });

  it("writes an inset layer as inset, in rem where the CSS says rem", () => {
    const { document } = tokensToDtcg({
      tokens: [shadow("shadow.well", "inset 0 0.125rem 0.25rem #000000")],
    });
    expect(at(document, "shadow.well")?.$value).toEqual({
      color: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" },
      offsetX: px(0),
      offsetY: { value: 0.125, unit: "rem" },
      blur: { value: 0.25, unit: "rem" },
      spread: px(0),
      inset: true,
    });
  });

  it("writes a colour variable as an alias to that variable", () => {
    const { document, issues } = tokensToDtcg({
      tokens: [
        brand,
        shadow("shadow.glow", "0 0 12px var(--site-color-brand)"),
      ],
    });
    expect(issues).toEqual([]);
    expect(at(document, "shadow.glow")?.$value).toMatchObject({
      color: "{color.brand}",
      blur: px(12),
    });
  });

  it("follows the site's prefix and a renamed variable's identity to the alias", () => {
    const renamed: SiteToken = { ...brand, id: "color.old", name: "color.ink" };
    const { document } = tokensToDtcg({
      prefix: "--acme-",
      tokens: [
        renamed,
        shadow("shadow.glow", "0 0 12px var(--acme-color-old)"),
      ],
    });
    expect(at(document, "shadow.glow")?.$value).toMatchObject({
      color: "{color.ink}",
    });
  });

  it("keeps a shadow it can't read as fields as Nextly-only data", () => {
    const { document, issues } = tokensToDtcg({
      tokens: [
        // No colour, a size computed by calc(), a variable that is no colour
        // of this site's, and none at all.
        shadow("shadow.plain", "0 1px 2px"),
        shadow("shadow.calc", "0 calc(1px + 1px) 2px #000000"),
        shadow("shadow.foreign", "0 1px 2px var(--elsewhere)"),
        shadow("shadow.none", "none"),
      ],
    });
    expect(issues).toEqual([]);
    expect(carried(document).sort()).toEqual([
      "shadow.calc",
      "shadow.foreign",
      "shadow.none",
      "shadow.plain",
    ]);
    expect(at(document, "shadow")).toBeUndefined();
  });

  it("reads every shadow back exactly, fields or not, light and dark", () => {
    const all = [
      brand,
      shadow("shadow.card", "0 4px 8px rgb(0 0 0 / 0.25)", "0 4px 8px #000"),
      shadow("shadow.glow", "0 0 12px var(--site-color-brand)"),
      shadow("shadow.plain", "0 1px 2px"),
    ];
    const { document } = tokensToDtcg({ tokens: all });
    const read = dtcgToTokens(JSON.parse(JSON.stringify(document)));
    expect(read.issues).toEqual([]);
    const byName = (list: readonly SiteToken[]) =>
      [...list].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(read.tokens)).toEqual(byName(all));
  });

  it("reads a shadow another tool wrote as CSS", () => {
    const read = dtcgToTokens({
      shadow: {
        lift: {
          $type: "shadow",
          $value: [
            {
              color: { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5 },
              offsetX: px(0),
              offsetY: px(2),
              blur: px(4),
              spread: px(0),
            },
            {
              color: {
                colorSpace: "srgb",
                components: [1, 0, 0],
                hex: "#ff0000",
              },
              offsetX: px(1),
              offsetY: px(1),
              blur: px(0),
              spread: { value: 0.5, unit: "rem" },
              inset: true,
            },
          ],
        },
      },
    });
    expect(read.issues).toEqual([]);
    expect(read.tokens).toEqual([
      shadow(
        "shadow.lift",
        "0px 2px 4px 0px rgb(0 0 0 / 0.5), inset 1px 1px 0px 0.5rem #ff0000"
      ),
    ]);
  });

  it("reads a layer's colour another tool wrote as an alias to a colour in the file", () => {
    const read = dtcgToTokens({
      color: {
        brand: {
          $type: "color",
          $value: {
            colorSpace: "srgb",
            components: [0.2, 0.4, 0.6],
            hex: "#336699",
          },
        },
      },
      shadow: {
        lift: {
          $type: "shadow",
          $value: {
            color: "{color.brand}",
            offsetX: px(0),
            offsetY: px(1),
            blur: px(2),
            spread: px(0),
          },
        },
      },
    });
    expect(read.issues).toEqual([]);
    expect(read.tokens).toContainEqual(
      shadow("shadow.lift", "0px 1px 2px 0px #336699")
    );
  });

  it("keeps a shadow as Nextly data where its colour variable isn't written as a token", () => {
    // `color.brand.tint` can't be written beside the token `color.brand`,
    // so an alias to it would point at nothing in the file.
    const written = tokensToDtcg({
      tokens: [
        brand,
        {
          name: "color.brand.tint",
          kind: "color",
          values: { light: "#99bbdd" },
        },
        shadow("shadow.lift", "0 1px 2px var(--site-color-brand-tint)"),
      ],
    }).document;
    expect(at(written, "shadow.lift")).toBeUndefined();
    expect(carried(written)).toContain("shadow.lift");
  });

  it("skips a shadow from another tool whose parts it can't read, saying so", () => {
    const read = dtcgToTokens({
      shadow: {
        odd: {
          $type: "shadow",
          $value: {
            color: "#000",
            offsetX: px(0),
            offsetY: px(1),
            blur: px(2),
          },
        },
      },
    });
    expect(read.tokens).toEqual([]);
    expect(read.issues.map(entry => entry.message).join(" ")).toContain(
      '"shadow.odd" has a value that could not be read'
    );
  });
});
