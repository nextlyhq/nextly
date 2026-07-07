import { describe, it, expect } from "vitest";

import { makeNode } from "../../core/tree";
import type { BlockDocument } from "../../core/types";
import "../../render/blocks"; // populate defaultBlockRegistry (block defaults)
import { editorReducer, initialState } from "./editorStore";

function baseDoc(): BlockDocument {
  return {
    version: 1,
    root: makeNode("core/container", {}, undefined, { default: [] }),
  };
}

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
