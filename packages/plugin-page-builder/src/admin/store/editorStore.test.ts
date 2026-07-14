import { describe, it, expect } from "vitest";

import { findNode, makeNode } from "../../core/tree";
import type { BlockDocument } from "../../core/types";
import "../../render/blocks"; // populate defaultBlockRegistry (block defaults)
import { editorReducer, initialState } from "./editorStore";

function baseDoc(): BlockDocument {
  return {
    version: 1,
    root: makeNode("core/container", {}, undefined, { default: [] }),
  };
}

function docWithChild(): { doc: BlockDocument; childId: string } {
  const child = makeNode("core/heading", { text: "Hi" });
  const root = makeNode("core/container", {}, undefined, { default: [child] });
  return { doc: { version: 1, root }, childId: child.id };
}

describe("editorReducer — advanced node fields", () => {
  it("SET_BLOCK_CSS / SET_CSS_ID / SET_ATTRIBUTES / SET_VISIBILITY update the node", () => {
    const { doc, childId } = docWithChild();
    let s = editorReducer(initialState(doc), {
      type: "SET_BLOCK_CSS",
      id: childId,
      css: "selector{color:red}",
    });
    expect(findNode(s.document.root, childId)!.customCss).toBe(
      "selector{color:red}"
    );
    s = editorReducer(s, { type: "SET_CSS_ID", id: childId, cssId: "hero" });
    expect(findNode(s.document.root, childId)!.cssId).toBe("hero");
    s = editorReducer(s, {
      type: "SET_ATTRIBUTES",
      id: childId,
      attributes: { "data-x": "1" },
    });
    expect(findNode(s.document.root, childId)!.attributes).toEqual({
      "data-x": "1",
    });
    s = editorReducer(s, {
      type: "SET_VISIBILITY",
      id: childId,
      breakpoint: "mobile",
      visible: false,
    });
    expect(findNode(s.document.root, childId)!.visibility).toEqual({
      mobile: false,
    });
  });
});

describe("editorReducer", () => {
  it("SELECT sets selectedId", () => {
    const s = editorReducer(initialState(baseDoc()), {
      type: "SELECT",
      id: "abc",
    });
    expect(s.selectedId).toBe("abc");
  });

  it("SET_BREAKPOINT changes the active breakpoint", () => {
    const s = editorReducer(initialState(baseDoc()), {
      type: "SET_BREAKPOINT",
      breakpoint: "mobile",
    });
    expect(s.activeBreakpoint).toBe("mobile");
  });

  it("ADD inserts a node from registry defaults, selects it, and pushes history", () => {
    const start = initialState(baseDoc());
    const rootId = start.document.root.id;
    const s = editorReducer(start, {
      type: "ADD",
      parentId: rootId,
      slot: "default",
      nodeType: "core/paragraph",
      index: 0,
    });
    const kids = s.document.root.slots!.default!;
    expect(kids.length).toBe(1);
    expect(kids[0].type).toBe("core/paragraph");
    expect(kids[0].props.text).toBe("New paragraph"); // default prop
    expect(s.selectedId).toBe(kids[0].id);
    expect(s.past.length).toBe(1);
    expect(s.dirty).toBe(true);
  });

  it("UNDO restores the previous document", () => {
    const start = initialState(baseDoc());
    const added = editorReducer(start, {
      type: "ADD",
      parentId: start.document.root.id,
      slot: "default",
      nodeType: "core/paragraph",
      index: 0,
    });
    const undone = editorReducer(added, { type: "UNDO" });
    expect(undone.document.root.slots!.default!.length).toBe(0);
    const redone = editorReducer(undone, { type: "REDO" });
    expect(redone.document.root.slots!.default!.length).toBe(1);
  });

  it("UNDO clears selection when the selected node no longer exists", () => {
    const start = initialState(baseDoc());
    const added = editorReducer(start, {
      type: "ADD",
      parentId: start.document.root.id,
      slot: "default",
      nodeType: "core/paragraph",
      index: 0,
    });
    const addedId = added.document.root.slots!.default![0].id;
    const selected = editorReducer(added, { type: "SELECT", id: addedId });
    // Undo removes the paragraph — selection must not dangle.
    const undone = editorReducer(selected, { type: "UNDO" });
    expect(undone.selectedId).toBeNull();
  });

  it("UNDO keeps selection when the selected node still exists", () => {
    const start = initialState(baseDoc());
    const rootId = start.document.root.id;
    const selected = editorReducer(start, { type: "SELECT", id: rootId });
    const added = editorReducer(selected, {
      type: "ADD",
      parentId: rootId,
      slot: "default",
      nodeType: "core/paragraph",
      index: 0,
    });
    // Root still exists after undo; if root was selected it stays selected.
    const reselectRoot = editorReducer(added, { type: "SELECT", id: rootId });
    const undone = editorReducer(reselectRoot, { type: "UNDO" });
    expect(undone.selectedId).toBe(rootId);
  });

  it("UPDATE_PROPS merges props", () => {
    const start = initialState(baseDoc());
    const added = editorReducer(start, {
      type: "ADD",
      parentId: start.document.root.id,
      slot: "default",
      nodeType: "core/heading",
      index: 0,
    });
    const id = added.document.root.slots!.default![0].id;
    const s = editorReducer(added, {
      type: "UPDATE_PROPS",
      id,
      props: { text: "Hi" },
    });
    const node = s.document.root.slots!.default![0];
    expect(node.props.text).toBe("Hi");
    expect(node.props.level).toBe("h2"); // untouched default
  });

  it("SET_CUSTOM_CLASS sets and clears the node customClass", () => {
    const start = initialState(baseDoc());
    const added = editorReducer(start, {
      type: "ADD",
      parentId: start.document.root.id,
      slot: "default",
      nodeType: "core/heading",
      index: 0,
    });
    const id = added.document.root.slots!.default![0].id;
    const set = editorReducer(added, {
      type: "SET_CUSTOM_CLASS",
      id,
      customClass: "  promo  ",
    });
    expect(set.document.root.slots!.default![0].customClass).toBe("promo");
    const cleared = editorReducer(set, {
      type: "SET_CUSTOM_CLASS",
      id,
      customClass: "   ",
    });
    expect(
      cleared.document.root.slots!.default![0].customClass
    ).toBeUndefined();
  });

  it("UPDATE_STYLE merges into the active breakpoint slice", () => {
    const start = initialState(baseDoc());
    const added = editorReducer(start, {
      type: "ADD",
      parentId: start.document.root.id,
      slot: "default",
      nodeType: "core/paragraph",
      index: 0,
    });
    const id = added.document.root.slots!.default![0].id;
    const s = editorReducer(added, {
      type: "UPDATE_STYLE",
      id,
      breakpoint: "mobile",
      style: { fontSize: "12px" },
    });
    expect(s.document.root.slots!.default![0].style?.mobile?.fontSize).toBe(
      "12px"
    );
  });

  it("MARK_SAVED clears dirty", () => {
    const start = initialState(baseDoc());
    const added = editorReducer(start, {
      type: "ADD",
      parentId: start.document.root.id,
      slot: "default",
      nodeType: "core/paragraph",
      index: 0,
    });
    expect(added.dirty).toBe(true);
    expect(editorReducer(added, { type: "MARK_SAVED" }).dirty).toBe(false);
  });

  it("SET_PAGE_CUSTOM_CSS updates customCss and marks dirty without touching history", () => {
    const start = initialState(baseDoc(), ".old{}");
    const s = editorReducer(start, {
      type: "SET_PAGE_CUSTOM_CSS",
      customCss: ".hero{color:red}",
    });
    expect(s.customCss).toBe(".hero{color:red}");
    expect(s.dirty).toBe(true);
    expect(s.past.length).toBe(0);
    expect(s.document).toBe(start.document);
  });

  it("REPLACE keeps the current customCss", () => {
    const start = initialState(baseDoc(), ".hero{color:red}");
    const s = editorReducer(start, { type: "REPLACE", document: baseDoc() });
    expect(s.customCss).toBe(".hero{color:red}");
  });

  it("bounds the undo history", () => {
    let s = initialState(baseDoc());
    for (let i = 0; i < 120; i++) {
      s = editorReducer(s, {
        type: "ADD",
        parentId: s.document.root.id,
        slot: "default",
        nodeType: "core/paragraph",
        index: 0,
      });
    }
    expect(s.past.length).toBeLessThanOrEqual(50);
  });
});
