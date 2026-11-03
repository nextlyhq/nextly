/**
 * The words a style keyword is offered in: every catalog keyword reads as
 * human words, never as its CSS spelling.
 *
 * @module style-keyword-labels.test
 */
import { STYLE_CATALOG } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { keywordLabel } from "./style-keyword-labels";

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
    // Every keyword the catalog offers, walked from the catalog itself, so a
    // keyword added later is covered without being listed here.
    const spelled: string[] = [];
    const walk = (leaf: unknown, css: string): void => {
      if (leaf === null || typeof leaf !== "object") return;
      const node = leaf as Record<string, unknown>;
      const property =
        typeof node.cssProperty === "string" ? node.cssProperty : css;
      const words = [
        ...(node.kind === "keyword" && Array.isArray(node.values)
          ? (node.values as string[])
          : []),
        ...(node.kind === "dimension" && Array.isArray(node.keywords)
          ? (node.keywords as string[])
          : []),
      ];
      for (const word of words) {
        if (word === "") continue;
        const label = keywordLabel(property, word);
        // Raw if it is the keyword as spelled, or still carries a hyphen. A
        // lowercase label is allowed: "a, b, c" shows the markers it draws.
        if (label === word || label.includes("-")) {
          spelled.push(`${property}: ${word} -> ${label}`);
        }
      }
      for (const value of Object.values(node)) walk(value, property);
    };
    for (const entry of STYLE_CATALOG) walk(entry, entry.property);
    expect(spelled).toEqual([]);
  });
});
