// @vitest-environment jsdom
/**
 * A run of typing is one step of the history: a field writing as the author
 * types moves the document with every write and undo takes the whole run
 * back, to the value before the author started; a new run is a new step.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { useEditorState } from "./editor-state";
import { joinTyping } from "./typing-run";

const text = (words: string): BlockNode => ({
  id: "t",
  type: "core/box",
  version: 1,
  props: { label: words },
});

const page = (node: BlockNode): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes: [node],
});

const write = (words: string) => ({
  kind: "update" as const,
  id: "t",
  patch: { props: { label: words } },
});

const label = (document: BlockDocument): unknown =>
  document.nodes[0]?.props.label;

describe("a run of typing", () => {
  it("moves the document with every write, and is undone in one step", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("Before")) })
    );
    const run = {};
    for (const words of ["H", "He", "Hel", "Hello"]) {
      act(() => {
        joinTyping(run, () => result.current.apply(write(words)));
      });
      expect(label(result.current.document)).toBe(words);
    }
    expect(result.current.undoDepth).toBe(1);

    act(() => {
      void result.current.undo();
    });
    expect(label(result.current.document)).toBe("Before");
    expect(result.current.canUndo).toBe(false);

    act(() => {
      void result.current.redo();
    });
    expect(label(result.current.document)).toBe("Hello");
  });

  it("starts a new step for a new run, and for any edit between two writes", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("A")) })
    );
    const first = {};
    act(() => {
      joinTyping(first, () => result.current.apply(write("AB")));
    });
    act(() => {
      joinTyping({}, () => result.current.apply(write("ABC")));
    });
    expect(result.current.undoDepth).toBe(2);

    // An edit that is not typing ends the run, so the run's next write is a
    // step of its own.
    act(() => {
      result.current.apply(write("ABCD"));
    });
    act(() => {
      joinTyping(first, () => result.current.apply(write("ABCDE")));
    });
    expect(result.current.undoDepth).toBe(4);
  });

  it("is a control: the same writes outside a run are a step each", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("")) })
    );
    for (const words of ["a", "ab", "abc"]) {
      act(() => {
        result.current.apply(write(words));
      });
    }
    expect(result.current.undoDepth).toBe(3);
  });
});
