/**
 * The words a style keyword is offered in: every catalog keyword reads as
 * human words, never as its CSS spelling.
 *
 * @module style-keyword-labels.test
 */
import { STYLE_CATALOG } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { keywordLabel, menuKeywords } from "./style-keyword-labels";

/** Every keyword the catalog offers, by the CSS property it is read for. */
function catalogKeywords(): { property: string; words: readonly string[] }[] {
  const found: { property: string; words: readonly string[] }[] = [];
  const listOf = (node: Record<string, unknown>): unknown =>
    node.kind === "keyword"
      ? node.values
      : node.kind === "dimension"
        ? node.keywords
        : undefined;
  const walk = (leaf: unknown, css: string): void => {
    if (leaf === null || typeof leaf !== "object") return;
    const node = leaf as Record<string, unknown>;
    const property =
      typeof node.cssProperty === "string" ? node.cssProperty : css;
    const words = listOf(node);
    if (Array.isArray(words)) {
      found.push({
        property,
        words: words.filter(
          (word): word is string => typeof word === "string" && word !== ""
        ),
      });
    }
    for (const value of Object.values(node)) walk(value, property);
  };
  for (const entry of STYLE_CATALOG) walk(entry, entry.property);
  return found;
}

describe("a style keyword's words", () => {
  it("names the keywords an author meets in human words", () => {
    expect(keywordLabel("display", "inline-flex")).toBe("Inline flex");
    expect(keywordLabel("display", "flow-root")).toBe("Contain floats");
    expect(keywordLabel("position", "static")).toBe("Normal flow");
    expect(keywordLabel("object-fit", "scale-down")).toBe("Shrink to fit");
    expect(keywordLabel("background-repeat", "no-repeat")).toBe("Don't repeat");
    expect(keywordLabel("list-style-type", "upper-roman")).toBe("I, II, III");
    expect(keywordLabel("overflow", "auto")).toBe("Scroll when needed");
  });

  it("keeps the words the alignment icons already use, one source for both", () => {
    expect(keywordLabel("flex-direction", "row-reverse")).toBe("Row, reversed");
    expect(keywordLabel("flex-wrap", "nowrap")).toBe("No wrap");
  });

  it("falls back to words shared across properties, then to the keyword humanised", () => {
    expect(keywordLabel("margin-block-start", "auto")).toBe("Auto");
    expect(keywordLabel("row-gap", "normal")).toBe("Default");
    expect(keywordLabel("justify-content", "space-between")).toBe(
      "Space between"
    );
    expect(keywordLabel("unknown-property", "some-word")).toBe("Some word");
  });

  it("never shows a keyword in its CSS spelling", () => {
    // Walked from the catalog itself, so a keyword added later is covered
    // without being listed here.
    const spelled: string[] = [];
    for (const { property, words } of catalogKeywords()) {
      for (const word of words) {
        const label = keywordLabel(property, word);
        // Raw if it is the keyword as spelled, or still carries a hyphen. A
        // lowercase label is allowed: "a, b, c" shows the markers it draws.
        if (label === word || label.includes("-")) {
          spelled.push(`${property}: ${word} -> ${label}`);
        }
      }
    }
    expect(spelled).toEqual([]);
  });

  it("reads a keyword however the validator accepts it spelled", () => {
    // Case and spacing are not part of a CSS keyword, so a stored
    // `INLINE-FLEX` reads as the inline-flex it is.
    expect(keywordLabel("display", "INLINE-FLEX")).toBe("Inline flex");
    expect(keywordLabel("grid-auto-flow", " Row   Dense ")).toBe(
      "Row, fill gaps"
    );
    expect(keywordLabel("unknown-property", "SOME-WORD")).toBe("Some word");
    // A CSS escape is the character it spells, so `inline\2d flex` is the
    // inline-flex the validator decodes it to.
    expect(keywordLabel("display", "inline\\2d flex")).toBe("Inline flex");
  });
});

describe("the keywords a menu offers", () => {
  it("offers one item per choice: only the second spelling of a value goes", () => {
    // Walked from the catalog, so a keyword added later that reads the same
    // as another is caught here rather than shown twice.
    const dropped: string[] = [];
    for (const { property, words } of catalogKeywords()) {
      const offered = menuKeywords(property, words, "");
      for (const word of words) {
        if (!offered.includes(word)) dropped.push(`${property}: ${word}`);
      }
    }
    expect(dropped).toEqual([
      "grid-auto-flow: dense row",
      "grid-auto-flow: dense column",
    ]);
  });

  it("puts a stored spelling in the place of the item it reads the same as", () => {
    const values = [
      "row",
      "column",
      "dense",
      "row dense",
      "column dense",
      "dense row",
      "dense column",
    ];
    expect(menuKeywords("grid-auto-flow", values, "dense row")).toEqual([
      "row",
      "column",
      "dense",
      "dense row",
      "column dense",
    ]);
    expect(
      menuKeywords("display", ["block", "inline-flex"], "INLINE-FLEX")
    ).toEqual(["block", "INLINE-FLEX"]);
    expect(
      menuKeywords("display", ["block", "inline-flex"], "inline\\2d flex")
    ).toEqual(["block", "inline\\2d flex"]);
  });

  it("offers a stored keyword the list lacks first, so the menu is never empty over it", () => {
    expect(menuKeywords("display", ["block", "flex"], "inherit")).toEqual([
      "inherit",
      "block",
      "flex",
    ]);
  });
});
