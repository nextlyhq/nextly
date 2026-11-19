// @vitest-environment jsdom

/**
 * The editor's state without its selection: the same view for as long as
 * only the selection moves, and a new one for any other change.
 *
 * @module editor-document-view.test
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { useDocumentView, useEditorState } from "./editor-state";

function node(id: string): BlockNode {
  return { id, type: "core/box", version: 1, props: {} };
}

const PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [node("a"), node("b")],
};

/** The editor's state and its view, as one surface would take both. */
function useBoth() {
  const editor = useEditorState({ initialDocument: PAGE });
  return { editor, view: useDocumentView(editor) };
}

describe("the editor's view without its selection", () => {
  it("holds no selection", () => {
    const { result } = renderHook(useBoth);
    act(() => {
      result.current.editor.select("a");
    });

    expect("selection" in result.current.view).toBe(false);
    expect("selectedId" in result.current.view).toBe(false);
    // The control: the state it was taken from holds one.
    expect(result.current.editor.selectedId).toBe("a");
  });

  it("is the same view while only the selection moves", () => {
    const { result } = renderHook(useBoth);
    const first = result.current.view;
    const firstEditor = result.current.editor;

    act(() => {
      result.current.editor.select("a");
    });
    act(() => {
      result.current.editor.select("b", "toggle");
    });
    act(() => {
      result.current.editor.select(null);
    });

    // The control: the state itself is a new object for each selection.
    expect(result.current.editor).not.toBe(firstEditor);
    expect(result.current.view).toBe(first);
  });

  it("is a new view for an edit, an undo and a list shown empty, each with what changed", () => {
    const { result } = renderHook(useBoth);
    const opened = result.current.view;

    act(() => {
      result.current.editor.apply({ kind: "remove", id: "b" });
    });
    const edited = result.current.view;
    expect(edited).not.toBe(opened);
    expect(edited.document.nodes.map(each => each.id)).toEqual(["a"]);
    expect(edited.canUndo).toBe(true);

    act(() => {
      void result.current.view.undo();
    });
    const undone = result.current.view;
    expect(undone).not.toBe(edited);
    expect(undone.document.nodes.map(each => each.id)).toEqual(["a", "b"]);
    expect(undone.canRedo).toBe(true);

    act(() => {
      result.current.view.showListEmpty?.("a", true);
    });
    expect(result.current.view).not.toBe(undone);
    expect(result.current.view.listsShowingEmpty?.has("a")).toBe(true);
  });

  it("holds the same functions as the state it was taken from", () => {
    const { result } = renderHook(useBoth);
    const { editor, view } = result.current;

    expect(view.select).toBe(editor.select);
    expect(view.apply).toBe(editor.apply);
    expect(view.undo).toBe(editor.undo);
    expect(view.document).toBe(editor.document);
  });
});
