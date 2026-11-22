/**
 * A page stored before the catalog gained a property keeps its exact CSS.
 *
 * Adding a catalog row is meant to be backwards-compatible: a new key, never a
 * new meaning for an old one. That is easy to state and easy to break without
 * noticing, because a change to emission order, to a shared keyword list or to
 * a compiler branch the new row needed would still compile, still validate and
 * still draw a page that looks about right. So this holds one document, styled
 * with every property the catalog had before outline was added, to the bytes
 * it compiled to then.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { validate } from "../validation";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { STYLE_CATALOG } from "./catalog";
import { compilePageCss } from "./compile-page";

/** Every catalog key before outline was added, in catalog order. */
const PROPERTIES_BEFORE = [
  "margin",
  "padding",
  "boxSizing",
  "display",
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  "alignContent",
  "gap",
  "rowGap",
  "columnGap",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridAutoFlow",
  "justifyItems",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "aspectRatio",
  "objectFit",
  "objectPosition",
  "overflow",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignSelf",
  "justifySelf",
  "order",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textAlign",
  "textTransform",
  "fontStyle",
  "listStyleType",
  "disclosureIcon",
  "disclosurePosition",
  "textDecoration",
  "textShadow",
  "color",
  "linkColor",
  "linkColorHover",
  "backgroundColor",
  "background",
  "backgroundGradient",
  "border",
  "borderRadius",
  "boxShadow",
  "opacity",
  "filter",
  "mixBlendMode",
  "transform",
  "transition",
  "position",
  "containerType",
];

/** One block per area of the catalog, so no two values compete. */
const STORED: Record<string, Record<string, unknown>> = {
  box: {
    margin: { blockStart: "1rem", inlineStart: "auto" },
    padding: { blockStart: "8px", inlineEnd: "2rem" },
    boxSizing: "border-box",
    display: "grid",
    gap: "1rem",
    rowGap: "4px",
    columnGap: "8px",
    gridTemplateColumns: "repeat(3, 1fr)",
    gridTemplateRows: "auto 1fr",
    gridAutoFlow: "row dense",
    justifyItems: "center",
    alignContent: "start",
    containerType: "inline-size",
  },
  row: {
    display: "flex",
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
  },
  child: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: "50%",
    alignSelf: "end",
    justifySelf: "start",
    order: -1,
  },
  size: {
    width: "fit-content",
    height: "100svh",
    minWidth: "10rem",
    minHeight: "50vh",
    maxWidth: "60ch",
    maxHeight: "none",
    aspectRatio: "16 / 9",
    overflow: "hidden auto",
  },
  media: {
    objectFit: "cover",
    objectPosition: "25% 75%",
  },
  text: {
    fontFamily: "Georgia, serif",
    fontSize: "1.25rem",
    fontWeight: 600,
    lineHeight: 1.5,
    letterSpacing: "0.02em",
    wordSpacing: "0.1em",
    textAlign: "center",
    textTransform: "uppercase",
    fontStyle: "italic",
    textDecoration: "underline dotted",
    textShadow: "0 1px 2px #0003",
    color: "#111",
    linkColor: "#00e",
    linkColorHover: "#00a",
    listStyleType: "square",
  },
  disclosure: {
    disclosureIcon: "plus",
    disclosurePosition: "before",
  },
  look: {
    backgroundColor: "#fafafa",
    background: {
      url: "/hero.jpg",
      position: "center",
      size: "cover",
      repeat: "no-repeat",
      attachment: "scroll",
      overlay: "#000",
      overlayStrength: 40,
    },
    backgroundGradient: "linear-gradient(#fff, #000)",
    border: {
      width: { blockStart: "1px", blockEnd: "thin" },
      style: "solid",
      color: "#ccc",
    },
    borderRadius: { startStart: "4px", endEnd: "8px 4px" },
    boxShadow: "0 1px 3px #0002",
    opacity: 0.9,
    filter: "blur(2px)",
    mixBlendMode: "multiply",
    transform: "rotate(2deg)",
    transition: "opacity 200ms ease",
    position: {
      type: "sticky",
      inset: { blockStart: "0" },
      zIndex: 2,
    },
  },
};

function storedDocument(): BlockDocument {
  const nodes = Object.entries(STORED).map(
    ([id, values]) =>
      ({
        id,
        type: "core/box",
        version: 1,
        props: {},
        styles: {
          base: { base: values, mobile: { color: "#222" } },
          hover: { base: { opacity: 1 } },
          focus: { base: { boxShadow: "0 0 0 2px #00e" } },
        },
      }) as BlockNode
  );
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/**
 * What the page compiled to before outline was added, byte for byte. Written
 * once from that catalog and never regenerated: a diff here is a change to
 * published pages. Plain text rather than `.css`, so no formatter rewrites the
 * bytes it holds.
 */
const STORED_CSS = readFileSync(
  new URL("./fixtures/stored-styles-before-outline.txt", import.meta.url),
  "utf8"
);

describe("a page stored before outline was added", () => {
  it("styles every property the catalog had then, and nothing it lacked", () => {
    const used = new Set(
      Object.values(STORED).flatMap(values => Object.keys(values))
    );
    expect([...used].sort()).toEqual([...PROPERTIES_BEFORE].sort());
    // Nothing the stored page uses has left the catalog.
    const now = new Set(STYLE_CATALOG.map(entry => entry.property));
    expect(PROPERTIES_BEFORE.filter(property => !now.has(property))).toEqual(
      []
    );
  });

  it("is still valid", () => {
    expect(
      validate(storedDocument(), {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      })
    ).toEqual([]);
  });

  it("compiles to the same bytes it did then", () => {
    const out = compilePageCss(storedDocument(), {
      breakpoints: FIXTURE_BREAKPOINTS,
    });
    expect(out.warnings).toEqual([]);
    // The fixture file ends in a newline, as every text file here does.
    expect(`${out.css}\n`).toBe(STORED_CSS);
  });
});
