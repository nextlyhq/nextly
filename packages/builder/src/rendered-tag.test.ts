// @vitest-environment jsdom

/**
 * Which element a node is actually drawn as, read off the canvas.
 *
 * `jsdom` and a separate file from `style-subject.test.ts`, whose cases are
 * pure walks over a document and would pay a DOM environment's startup for
 * nothing. The package's config states that choice per file rather than
 * globally.
 *
 * @module __tests__/rendered-tag
 */
import { describe, expect, it } from "vitest";

import { renderedTagOf } from "./style-subject";

/**
 * A canvas holding the three cases that matter.
 *
 * The rich-text node is the one that decides the whole approach: `core/rich-text`
 * renders `<div className={className}>` and puts headings in its CONTENT, so the
 * typographic baseline styles text inside that block and not the block's own
 * box. A reader answering from the block type, or taking the first heading it
 * found underneath, would report the opposite — and the panel would offer a
 * heading's font size on a control that cannot change it.
 */
function canvas(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <h1 data-nx-node="heading-1">A title</h1>
    <div data-nx-node="rich-1"><h1>A title inside a passage</h1></div>
    <p data-nx-node="odd.id:with*chars">Escaping</p>
  `;
  // Set rather than written into the markup, because the id itself contains a
  // quote and a backslash — the two characters that end an attribute value
  // early in BOTH the HTML above and the selector below.
  const hostile = document.createElement("span");
  hostile.setAttribute("data-nx-node", 'quote" and \\ backslash');
  root.append(hostile);
  return root;
}

describe("the element a node is drawn as", () => {
  it("reads the tag off the element carrying the node id", () => {
    expect(renderedTagOf(canvas(), "heading-1")).toBe("h1");
  });

  it("answers a rich-text block with its OWN root, not the heading inside it", () => {
    expect(renderedTagOf(canvas(), "rich-1")).toBe("div");
  });

  it("escapes a node id before it reaches the selector", () => {
    // A node id is author data reaching a SELECTOR. Unescaped, `querySelector`
    // THROWS on invalid syntax rather than returning nothing — so an id an
    // author is free to choose would take down the whole panel rather than lose
    // one indicator.
    expect(renderedTagOf(canvas(), "odd.id:with*chars")).toBe("p");
    // The two characters that actually matter inside a quoted attribute value.
    // The case above passes with NO escaping at all, because a `.` or `:` is
    // already literal in there — only these end the string early.
    expect(renderedTagOf(canvas(), 'quote" and \\ backslash')).toBe("span");
  });

  it("says nothing when the node is not drawn, or there is no canvas", () => {
    // Each way a caller can be unable to answer returns `undefined`, so
    // `styleOrigin` refuses the baseline rather than guessing at it.
    expect(renderedTagOf(canvas(), "absent")).toBeUndefined();
    expect(renderedTagOf(null, "heading-1")).toBeUndefined();
    expect(renderedTagOf(canvas(), null)).toBeUndefined();
  });
});
