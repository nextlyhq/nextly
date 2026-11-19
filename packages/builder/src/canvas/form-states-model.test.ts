// @vitest-environment jsdom

/**
 * Which drawn blocks are the document's Forms: each once, nested ones
 * included, an id judged by the first node it names as the editor's lookup
 * judges it, and the page read once per measure however many blocks it draws.
 *
 * @module canvas/form-states-model.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import { FORM_BLOCK } from "../inspector/content/form-picked";

import { drawnForms } from "./form-states-model";

const block = (id: string, type: string, children?: BlockNode[]): BlockNode =>
  ({
    id,
    type,
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: { children } }),
  }) as BlockNode;

function page(nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

/** A drawn block for each id, in the order given. */
function drawn(...ids: string[]): Element[] {
  return ids.map(id => {
    const element = document.createElement("div");
    element.setAttribute(NODE_ID_ATTRIBUTE, id);
    return element;
  });
}

describe("drawnForms", () => {
  it("finds the Forms the page draws, nested ones included, each once", () => {
    const doc = page([
      block("intro", "core/heading"),
      block("box", "core/box", [block("signup", FORM_BLOCK)]),
      block("contact", FORM_BLOCK),
    ]);
    const found = drawnForms(
      drawn("intro", "box", "signup", "contact", "signup"),
      doc
    );
    expect(found.map(form => form.nodeId)).toEqual(["signup", "contact"]);
  });

  it("judges an id by the first node it names, as finding a node does", () => {
    // A page holding one id twice, a Heading first: the editor's lookup
    // answers the Heading, so no Form is drawn under that id.
    const doc = page([
      block("twice", "core/heading"),
      block("box", "core/box", [block("twice", FORM_BLOCK)]),
    ]);
    expect(drawnForms(drawn("twice"), doc)).toEqual([]);
  });

  it("reads the page's blocks once however many blocks are drawn", () => {
    const nodes = Array.from({ length: 40 }, (_, index) =>
      block(`b${String(index)}`, index === 39 ? FORM_BLOCK : "core/text")
    );
    let reads = 0;
    const doc = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      get nodes() {
        reads += 1;
        return nodes;
      },
    } as unknown as BlockDocument;
    const found = drawnForms(drawn(...nodes.map(node => node.id)), doc);
    expect(found.map(form => form.nodeId)).toEqual(["b39"]);
    expect(reads).toBe(1);
  });
});
