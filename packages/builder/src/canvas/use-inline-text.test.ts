// @vitest-environment jsdom
/**
 * Finding the element that carries a value.
 *
 * The part of inline editing that varies per block, and the part a hook's
 * result cannot show: a wrong answer here is an edit that quietly never begins,
 * which reads to an author as a key that does nothing.
 *
 * @module use-inline-text.test
 */
import { describe, expect, it } from "vitest";

import { editableElement } from "./use-inline-text";

/** Build a rendered fragment the way the renderer marks one. */
function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("editableElement", () => {
  it("finds a marker on the node's OWN root element", () => {
    // An unlinked heading is exactly this: one `<h2>` carrying both attributes.
    // A descendant-only search misses it, and the failure is silent.
    const root = render(`<h2 data-nx-node="a" data-nx-prop="text">Hello</h2>`);

    const found = editableElement(root, { nodeId: "a", prop: "text" });

    expect(found?.tagName).toBe("H2");
  });

  it("finds a marker on a DESCENDANT of the node", () => {
    // A linked heading puts the words inside the anchor, and a quote puts them
    // inside a paragraph nested in a figure.
    const root = render(
      `<h2 data-nx-node="a"><a href="/x" data-nx-prop="text">Hello</a></h2>`
    );

    const found = editableElement(root, { nodeId: "a", prop: "text" });

    expect(found?.tagName).toBe("A");
  });

  it("finds the named value among several on one node", () => {
    const root = render(
      `<figure data-nx-node="a">
         <blockquote><p data-nx-prop="text">Quoted</p></blockquote>
         <figcaption><cite data-nx-prop="source">A Book</cite></figcaption>
       </figure>`
    );

    expect(
      editableElement(root, { nodeId: "a", prop: "source" })?.tagName
    ).toBe("CITE");
    expect(editableElement(root, { nodeId: "a", prop: "text" })?.tagName).toBe(
      "P"
    );
  });

  it("does not reach into ANOTHER node's marked element", () => {
    // Nodes nest, so a container's search would otherwise find its child's
    // text and put the caret in a block the author did not select.
    const root = render(
      `<section data-nx-node="outer">
         <h2 data-nx-node="inner" data-nx-prop="text">Child</h2>
       </section>`
    );

    expect(editableElement(root, { nodeId: "outer", prop: "text" })).toBeNull();
    // The control: the same tree does answer for the node that owns the value.
    expect(
      editableElement(root, { nodeId: "inner", prop: "text" })?.textContent
    ).toBe("Child");
  });

  it("answers null for a value nothing marked", () => {
    const root = render(`<h2 data-nx-node="a" data-nx-prop="text">Hi</h2>`);

    expect(editableElement(root, { nodeId: "a", prop: "source" })).toBeNull();
  });

  it("answers null for a node that is not rendered", () => {
    const root = render(`<h2 data-nx-node="a" data-nx-prop="text">Hi</h2>`);

    expect(editableElement(root, { nodeId: "b", prop: "text" })).toBeNull();
  });

  it("treats a node id as data rather than as a selector", () => {
    // Ids reach this from stored documents. Interpolated into a selector, a
    // character CSS treats specially either throws or matches something else —
    // so an id full of them still resolves to its own element, and only to it.
    const odd = 'a"],[data-nx-node="b';
    const root = render(
      `<h2 data-nx-node='${odd}' data-nx-prop="text">Odd</h2>
       <h2 data-nx-node="b" data-nx-prop="text">Other</h2>`
    );

    expect(
      editableElement(root, { nodeId: odd, prop: "text" })?.textContent
    ).toBe("Odd");
    expect(
      editableElement(root, { nodeId: "b", prop: "text" })?.textContent
    ).toBe("Other");
  });
});
