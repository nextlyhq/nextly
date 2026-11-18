// @vitest-environment jsdom
/**
 * A run of typing is one step of the history: a field writing as the author
 * types moves the document with every write and undo takes the whole run
 * back, to the value before the author started; a new run is a new step.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { MAX_HISTORY } from "./editor-history";
import { useEditorState } from "./editor-state";
import { endTypingRuns, joinTyping } from "./typing-run";

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

describe("a run of typing's step", () => {
  it("is undone exactly: the document before the run, deep-equal", () => {
    const before = page({
      ...text("Before"),
      props: { label: "Before", tone: "quiet" },
    });
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: before })
    );
    const run = {};
    for (const words of ["N", "Ne", "New"]) {
      act(() => {
        joinTyping(run, () => result.current.apply(write(words)));
      });
    }
    act(() => {
      void result.current.undo();
    });
    expect(result.current.document).toEqual(before);
  });
});

describe("cancelling a run of typing", () => {
  it("puts back the value from before the run and records nothing", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("Before")) })
    );
    const run = {};
    for (const words of ["A", "Ab"]) {
      act(() => {
        joinTyping(run, () => result.current.apply(write(words)));
      });
    }
    let cancelled = false;
    act(() => {
      cancelled = result.current.cancelTyping(run);
    });
    expect(cancelled).toBe(true);
    expect(label(result.current.document)).toBe("Before");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("leaves the history as it was before the run, redo branch included", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("One")) })
    );
    act(() => {
      result.current.apply(write("Two"));
    });
    act(() => {
      void result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);
    // The run's first write ends the redo branch, as any edit does.
    const run = {};
    act(() => {
      joinTyping(run, () => result.current.apply(write("Typed")));
    });
    expect(result.current.canRedo).toBe(false);
    act(() => {
      result.current.cancelTyping(run);
    });
    expect(label(result.current.document)).toBe("One");
    expect(result.current.canRedo).toBe(true);
    act(() => {
      void result.current.redo();
    });
    expect(label(result.current.document)).toBe("Two");
  });

  it("gives back the oldest step a full history dropped for the run", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("0")) })
    );
    for (let edit = 1; edit <= MAX_HISTORY; edit++) {
      act(() => {
        result.current.apply(write(String(edit)));
      });
    }
    const run = {};
    act(() => {
      joinTyping(run, () => result.current.apply(write("typed")));
    });
    act(() => {
      result.current.cancelTyping(run);
    });
    // Every one of the hundred edits undoes again, back to the first value.
    for (let edit = 0; edit < MAX_HISTORY; edit++) {
      act(() => {
        void result.current.undo();
      });
    }
    expect(label(result.current.document)).toBe("0");
  });

  it("puts nothing back once the run has ended: after another edit, or an undo", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("A")) })
    );
    const run = {};
    act(() => {
      joinTyping(run, () => result.current.apply(write("AB")));
    });
    act(() => {
      result.current.apply(write("ABC"));
    });
    let cancelled = true;
    act(() => {
      cancelled = result.current.cancelTyping(run);
    });
    expect(cancelled).toBe(false);
    expect(label(result.current.document)).toBe("ABC");
    expect(result.current.undoDepth).toBe(2);

    const undone = {};
    act(() => {
      joinTyping(undone, () => result.current.apply(write("X")));
    });
    act(() => {
      void result.current.undo();
    });
    act(() => {
      cancelled = result.current.cancelTyping(undone);
    });
    expect(cancelled).toBe(false);
    expect(label(result.current.document)).toBe("ABC");
  });
});

describe("a save while a field is still being typed in", () => {
  it("ends the run, so typing on after the save is a step of its own", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("A")) })
    );
    const run = {};
    act(() => {
      joinTyping(run, () => result.current.apply(write("AB")));
    });
    // The save shortcut, pressed without leaving the field.
    act(() => {
      endTypingRuns();
    });
    act(() => {
      joinTyping(run, () => result.current.apply(write("ABC")));
    });
    // Two steps: undo after the save takes back only what came after it, so
    // the saved page and the history's count of unsaved work agree.
    expect(result.current.undoDepth).toBe(2);
    act(() => {
      void result.current.undo();
    });
    expect(label(result.current.document)).toBe("AB");
  });

  it("leaves the saved words alone when Escape cancels after the save", () => {
    const { result } = renderHook(() =>
      useEditorState({ initialDocument: page(text("A")) })
    );
    const run = {};
    act(() => {
      joinTyping(run, () => result.current.apply(write("AB")));
    });
    act(() => {
      endTypingRuns();
    });
    let cancelled = true;
    act(() => {
      cancelled = result.current.cancelTyping(run);
    });
    // What was saved is ordinary history now: Escape takes nothing back.
    expect(cancelled).toBe(false);
    expect(label(result.current.document)).toBe("AB");
  });
});
