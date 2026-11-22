/**
 * A shadow read into the layers its fields show, and the layers written back.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  NEW_SHADOW_LAYER,
  readShadow,
  shadowFollowsDark,
  shadowPreview,
  writeShadow,
  type ShadowLayer,
} from "./shadow-css";

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "color.text",
      kind: "color",
      values: { light: "#111111", dark: "#eeeeee" },
    },
    // Renamed: its custom property keeps the identity it was made with.
    {
      id: "color.line",
      name: "color.border",
      kind: "color",
      values: { light: "#dddddd" },
    },
    { name: "space.4", kind: "dimension", values: { light: "16px" } },
  ],
};

const layer = (over: Partial<ShadowLayer>): ShadowLayer => ({
  ...NEW_SHADOW_LAYER,
  ...over,
});

describe("reading a shadow and writing it back", () => {
  it.each([
    ["a single layer", "0 4px 12px rgba(0, 0, 0, 0.2)"],
    [
      "two layers, one inside",
      "inset 0 1px 0 rgba(255,255,255,.2), 0 2px 4px #0003",
    ],
    ["a layer with its spread", "0 0 0 1px #000"],
    ["a colour variable", "0 2px 4px var(--site-color-text)"],
    [
      "a renamed colour variable, by its identity",
      "0 1px 2px var(--site-color-line)",
    ],
    ["a layer with no colour", "2px 2px"],
  ])("leaves %s unchanged", (_label, text) => {
    const read = readShadow(text, TOKENS);
    expect(read.kind).toBe("layers");
    if (read.kind !== "layers") return;
    expect(writeShadow(read.layers, TOKENS)).toBe(text);
  });

  it("reads each part into its field", () => {
    expect(
      readShadow("inset -2px 3px 6px 1px var(--site-color-text)", TOKENS)
    ).toEqual({
      kind: "layers",
      layers: [
        {
          inset: true,
          x: "-2px",
          y: "3px",
          blur: "6px",
          spread: "1px",
          colour: { kind: "variable", identity: "color.text" },
        },
      ],
    });
  });

  it("reads no shadow as no layers", () => {
    expect(readShadow("none", TOKENS)).toEqual({ kind: "layers", layers: [] });
    expect(readShadow("", TOKENS)).toEqual({ kind: "layers", layers: [] });
  });

  it.each([
    ["a size through calc()", "calc(1px + 1px) 2px 4px #000"],
    ["a variable the site does not have", "0 2px 4px var(--site-color-gone)"],
    ["a variable that is not a colour", "0 2px 4px var(--site-space-4)"],
    ["a variable with a fallback", "0 2px 4px var(--site-color-text, #000)"],
    ["a size through a variable", "var(--site-space-4) 2px 4px #000"],
    ["two colours in a layer", "0 2px 4px red blue"],
    ["a word", "0 2px 4px banana"],
    ["a CSS-wide keyword", "inherit"],
  ])("keeps %s as CSS", (_label, text) => {
    expect(readShadow(text, TOKENS)).toEqual({ kind: "css" });
  });
});

describe("writing layers", () => {
  it("writes one layer", () => {
    expect(
      writeShadow(
        [layer({ x: "0", y: "4px", blur: "12px", spread: undefined })],
        TOKENS
      )
    ).toBe("0 4px 12px rgba(0, 0, 0, 0.12)");
  });

  it("writes two layers apart with a comma", () => {
    expect(
      writeShadow(
        [
          layer({
            x: "0",
            y: "1px",
            blur: "2px",
            colour: { kind: "raw", value: "#000" },
          }),
          layer({
            x: "0",
            y: "4px",
            blur: "8px",
            colour: { kind: "variable", identity: "color.text" },
          }),
        ],
        TOKENS
      )
    ).toBe("0 1px 2px #000, 0 4px 8px var(--site-color-text)");
  });

  it("writes an inside layer with inset first", () => {
    expect(
      writeShadow([layer({ inset: true, x: "0", y: "1px", blur: "0" })], TOKENS)
    ).toBe("inset 0 1px 0 rgba(0, 0, 0, 0.12)");
  });

  it("writes a zero blur where only the spread is set", () => {
    expect(
      writeShadow(
        [layer({ x: "0", y: "0", blur: undefined, spread: "2px" })],
        TOKENS
      )
    ).toBe("0 0 0 2px rgba(0, 0, 0, 0.12)");
  });

  it("writes no layers as no shadow", () => {
    expect(writeShadow([], TOKENS)).toBe("none");
  });

  it("names a colour variable under the site's own prefix", () => {
    const prefixed: SiteTokenSet = { ...TOKENS, prefix: "--brand-" };
    const written = writeShadow(
      [layer({ colour: { kind: "variable", identity: "color.text" } })],
      prefixed
    );
    expect(written).toContain("var(--brand-color-text)");
    expect(readShadow(written, prefixed).kind).toBe("layers");
  });
});

describe("the preview", () => {
  const layers = [
    layer({ colour: { kind: "variable", identity: "color.text" } }),
  ];

  it("paints a colour variable with its value in each mode", () => {
    expect(shadowPreview(layers, TOKENS, "light")).toBe("0 4px 12px #111111");
    expect(shadowPreview(layers, TOKENS, "dark")).toBe("0 4px 12px #eeeeee");
  });

  it("has a dark look only where a colour it uses has a dark value", () => {
    expect(shadowFollowsDark(layers, TOKENS)).toBe(true);
    expect(
      shadowFollowsDark(
        [layer({ colour: { kind: "variable", identity: "color.line" } })],
        TOKENS
      )
    ).toBe(false);
    expect(shadowFollowsDark([layer({})], TOKENS)).toBe(false);
  });
});
