/**
 * Paste is the one insertion path whose payload was built somewhere else.
 *
 * Everything else the reducer inserts it also constructed: a fresh node has no children, so
 * checking the destination is the whole question. A clipboard subtree was assembled under whatever
 * rules were in force when it was copied — an older definition, a plugin that has since narrowed a
 * slot — and its outermost type says nothing about the relations inside it.
 */
import { describe, expect, it } from "vitest";

import "../../render/blocks";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import { validateDocument } from "../../core/validate";
import type { BlockDocument, BlockNode } from "../../core/types";
import { editorReducer, initialState } from "./editorStore";

const node = (type: string, slots?: Record<string, BlockNode[]>): BlockNode =>
  makeNode(type, {}, undefined, slots);

/** A page whose root container is empty and accepts anything. */
function emptyPage(): BlockDocument {
  return { version: 1, root: node("core/container", { default: [] }) };
}

function paste(document: BlockDocument, pasted: BlockNode) {
  const state = initialState(document);
  return editorReducer(state, {
    type: "PASTE_NODE",
    parentId: document.root.id,
    slot: "default",
    index: 0,
    node: pasted,
  });
}

describe("pasting a subtree", () => {
  it("still inserts into a page that ALREADY has a fault elsewhere", () => {
    // This PR creates exactly this page: a stored `core/columns` row holding an ordinary block
    // stays that way until its author takes the repair. Judging only the result would refuse every
    // unrelated paste while such a row exists, silently — the Paste action looking broken on
    // precisely the pages this change affects.
    const document: BlockDocument = {
      version: 1,
      root: node("core/container", {
        default: [node("core/columns", { default: [node("core/heading")] })],
      }),
    };
    // The precondition: the page really is unsaveable before anything is pasted.
    expect(
      validateDocument(document, defaultBlockRegistry, { allowUnknown: true })
    ).not.toBe(true);

    const next = paste(document, node("core/heading"));
    expect(next.document.root.slots?.default).toHaveLength(2);
  });

  it("still inserts when an UNRELATED unknown block sits elsewhere on the page", () => {
    // A page may hold a block whose plugin this process has not loaded, and that block is
    // preserved rather than rejected. Judging the whole document with the write path's default
    // policy refused every paste while such a block existed anywhere — an unrelated edit made
    // impossible, preserving nothing.
    const document: BlockDocument = {
      version: 1,
      root: node("core/container", { default: [node("acme/not-loaded")] }),
    };
    const next = paste(document, node("core/heading"));
    expect(next.document.root.slots?.default).toHaveLength(2);
  });

  it("inserts one whose internal relations are all legal", () => {
    // The positive control, and the reason the refusal below is about the subtree rather than about
    // paste being broken: the same operation with a well-formed tree does insert.
    const document = emptyPage();
    const wellFormed = node("core/columns", {
      default: [node("core/column", { default: [node("core/heading")] })],
    });
    const next = paste(document, wellFormed);
    expect(next.document.root.slots?.default).toHaveLength(1);
    expect(next.document.root.slots?.default[0].type).toBe("core/columns");
  });

  it("refuses one whose descendants violate a slot its own root does not", () => {
    // `core/columns` is welcome in a container, so the destination check passes on the outermost
    // block — and the heading directly inside it is refused by the row's allowlist. Judging the
    // root alone admits the whole tree and leaves the page unsaveable for a fault several levels
    // down that the author neither made nor can see.
    const document = emptyPage();
    const rowWithBareHeading = node("core/columns", {
      default: [node("core/heading")],
    });
    const next = paste(document, rowWithBareHeading);
    expect(next.document.root.slots?.default).toHaveLength(0);
  });

  it("refuses one whose descendant breaks the child's own parent rule", () => {
    // The other half of the nesting rule, and the one no parent can express: a stray `core/column`
    // nested inside a container that would otherwise take anything.
    const document = emptyPage();
    const strayColumn = node("core/container", {
      default: [node("core/column", { default: [] })],
    });
    const next = paste(document, strayColumn);
    expect(next.document.root.slots?.default).toHaveLength(0);
  });

  it("leaves the document object itself untouched when it refuses", () => {
    // A refusal must not count as an edit: an unchanged state keeps undo history and the dirty flag
    // honest, so a rejected paste cannot make a clean page look unsaved.
    const document = emptyPage();
    const state = initialState(document);
    const next = editorReducer(state, {
      type: "PASTE_NODE",
      parentId: document.root.id,
      slot: "default",
      index: 0,
      node: node("core/columns", { default: [node("core/heading")] }),
    });
    expect(next).toBe(state);
    expect(next.dirty).toBe(false);
  });
});
