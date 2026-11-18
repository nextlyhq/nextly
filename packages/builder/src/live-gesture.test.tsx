// @vitest-environment jsdom
/**
 * A drag that writes as the pointer moves: every write is one step of the
 * editor's history, at most one write is made a frame however many moves
 * the frame holds, and a drag let go of or abandoned leaves the history as
 * one step or none.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorState } from "./editor-state";
import { TypingCancel } from "./live-draft";
import { useLiveGesture } from "./live-gesture";

const box = (width: string): BlockNode => ({
  id: "b",
  type: "core/box",
  version: 1,
  props: { label: width },
});

const page: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [box("10")],
};

const write = (value: string) => ({
  kind: "update" as const,
  id: "b",
  patch: { props: { label: value } },
});

const label = (document: BlockDocument): unknown =>
  document.nodes[0]?.props.label;

/** The frames asked for and not yet drawn, run by `frame()`. */
let frames: FrameRequestCallback[] = [];
function frame(): void {
  const due = frames;
  frames = [];
  act(() => {
    for (const draw of due) draw(0);
  });
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => {
    frames.push(draw);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An editor, and a gesture drawn over it as the block panel draws one. */
function mount() {
  return renderHook(
    () => {
      const editor = useEditorState({ initialDocument: page });
      return { editor, gesture: useLiveGesture() };
    },
    {
      wrapper: function Panel({ children }: { children: React.ReactNode }) {
        // The panel's own provider reads the editor below it; here the
        // editor is the hook's, so the cancel is lent from a holder.
        return (
          <TypingCancel.Provider value={run => cancel.current(run)}>
            {children}
          </TypingCancel.Provider>
        );
      },
    }
  );
}
const cancel: { current: (run: object) => boolean } = {
  current: () => false,
};

function moveTo(
  result: ReturnType<typeof mount>["result"],
  value: string
): void {
  act(() => {
    result.current.gesture.move(() => {
      result.current.editor.apply(write(value));
    });
  });
}

describe("a drag that writes as the pointer moves", () => {
  it("writes once a frame, whatever the number of moves in it", () => {
    const { result } = mount();
    const apply = vi.spyOn(result.current.editor, "apply");
    moveTo(result, "11");
    moveTo(result, "12");
    moveTo(result, "13");
    expect(label(result.current.editor.document)).toBe("10");

    frame();
    expect(label(result.current.editor.document)).toBe("13");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("is one undo step for every frame of the drag and its release", () => {
    const { result } = mount();
    moveTo(result, "11");
    frame();
    moveTo(result, "12");
    frame();
    act(() => {
      result.current.gesture.end(() => {
        result.current.editor.apply(write("14"));
      });
    });
    expect(label(result.current.editor.document)).toBe("14");
    expect(result.current.editor.undoDepth).toBe(1);

    act(() => {
      void result.current.editor.undo();
    });
    expect(label(result.current.editor.document)).toBe("10");
  });

  it("writes nothing more once let go, though a move was waiting for its frame", () => {
    const { result } = mount();
    moveTo(result, "11");
    frame();
    moveTo(result, "12");
    act(() => result.current.gesture.end());
    frame();
    expect(label(result.current.editor.document)).toBe("11");
  });

  it("puts the value back and records nothing when abandoned", () => {
    const { result } = mount();
    cancel.current = run => result.current.editor.cancelTyping(run);
    moveTo(result, "11");
    frame();
    moveTo(result, "12");
    act(() => result.current.gesture.cancel());
    frame();
    expect(label(result.current.editor.document)).toBe("10");
    expect(result.current.editor.undoDepth).toBe(0);
  });

  it("starts a new step for the next drag", () => {
    const { result } = mount();
    moveTo(result, "11");
    frame();
    act(() => result.current.gesture.end());
    moveTo(result, "12");
    frame();
    act(() => result.current.gesture.end());
    expect(result.current.editor.undoDepth).toBe(2);
  });
});
