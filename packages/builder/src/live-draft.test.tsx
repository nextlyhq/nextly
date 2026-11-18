// @vitest-environment jsdom
/**
 * A field's draft that writes as it is typed: each keystroke handed to the
 * field's write inside one run of typing, the field's own writes leaving the
 * text as typed, and a value that is not one yet writing nothing, so the
 * canvas keeps the last value that was.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { typedNumber, typedStyleText, useLiveDraft } from "./live-draft";
import { endTypingRuns, typingRunNow } from "./typing-run";

/** A stored value the hook follows, and the writes made to it. */
function storedValue(initial: string) {
  const state = { stored: initial, runs: [] as (object | null)[] };
  const write = (text: string): boolean => {
    state.runs.push(typingRunNow());
    state.stored = text;
    return true;
  };
  return { state, write };
}

describe("the last valid value rule", () => {
  it("reads a number only once one is typed", () => {
    expect(typedNumber("12")).toBe(12);
    expect(typedNumber(" 1.5 ")).toBe(1.5);
    expect(typedNumber("-3")).toBe(-3);
    // Not numbers yet: nothing is written, so the last one stays.
    expect(typedNumber("")).toBeUndefined();
    expect(typedNumber("   ")).toBeUndefined();
    expect(typedNumber("-")).toBeUndefined();
    expect(typedNumber("1e")).toBeUndefined();
    expect(typedNumber("12p")).toBeUndefined();
  });

  it("holds an emptied style field until it is left, where it clears", () => {
    expect(typedStyleText("24")).toBe("24");
    expect(typedStyleText("#ff")).toBe("#ff");
    expect(typedStyleText("")).toBeUndefined();
    // CSS whitespace only, as the field's own commit reads it.
    expect(typedStyleText(" \t")).toBeUndefined();
  });
});

describe("a live draft", () => {
  it("writes every keystroke in one run, and keeps the text as typed", () => {
    const { state, write } = storedValue("Old");
    const { result, rerender } = renderHook(
      ({ stored }) => useLiveDraft(stored),
      { initialProps: { stored: state.stored } }
    );
    for (const text of ["N", "Ne", "New"]) {
      act(() => result.current.type(text, write));
      // The store answers with its own spelling, as a style does ("24" is
      // stored as "24px"): the field goes on showing what was typed.
      rerender({ stored: `${state.stored}!` });
      expect(result.current.draft).toBe(text);
    }
    expect(state.runs).toHaveLength(3);
    expect(state.runs[0]).not.toBeNull();
    expect(new Set(state.runs).size).toBe(1);
  });

  it("starts a new run once the edit ends", () => {
    const { state, write } = storedValue("A");
    const { result } = renderHook(() => useLiveDraft(state.stored));
    act(() => result.current.type("AB", write));
    act(() => result.current.end());
    act(() => result.current.type("ABC", write));
    expect(state.runs[0]).not.toBeNull();
    expect(state.runs[1]).not.toBeNull();
    expect(state.runs[0]).not.toBe(state.runs[1]);
  });

  it("starts a new run after a save, though the field was never left", () => {
    const { state, write } = storedValue("A");
    const { result } = renderHook(() => useLiveDraft(state.stored));
    act(() => result.current.type("AB", write));
    act(() => endTypingRuns());
    act(() => result.current.type("ABC", write));
    expect(state.runs[0]).not.toBeNull();
    expect(state.runs[1]).not.toBeNull();
    expect(state.runs[0]).not.toBe(state.runs[1]);
  });

  it("joins a write made after typing to the same run, until it ends", () => {
    const { state, write } = storedValue("1");
    const { result } = renderHook(() => useLiveDraft(state.stored));
    act(() => result.current.type("12", write));
    const joined = result.current.join(() => typingRunNow());
    expect(joined).toBe(state.runs[0]);
    act(() => result.current.end());
    expect(result.current.join(() => typingRunNow())).toBeNull();
  });

  it("writes nothing for a value its write refuses, and shows it as typed", () => {
    const { result } = renderHook(() => useLiveDraft("24px"));
    act(() => result.current.type("24p", () => false));
    expect(result.current.draft).toBe("24p");
  });

  it("follows a stored value moved by anything else", () => {
    const { result, rerender } = renderHook(
      ({ stored }) => useLiveDraft(stored),
      { initialProps: { stored: "Old" } }
    );
    // Typed but refused: the document did not move for it.
    act(() => result.current.type("Ol", () => false));
    // An undo, or an edit from the canvas.
    rerender({ stored: "Other" });
    expect(result.current.draft).toBe("Other");
  });

  it("follows the stored value after its own write once the edit ends", () => {
    const { state, write } = storedValue("1");
    const { result, rerender } = renderHook(
      ({ stored }) => useLiveDraft(stored),
      { initialProps: { stored: state.stored } }
    );
    act(() => result.current.type("2", write));
    act(() => result.current.end());
    rerender({ stored: "2px" });
    expect(result.current.draft).toBe("2px");
  });

  it("knows the text its last keystroke wrote, and settles it in the stored spelling", () => {
    const { state, write } = storedValue("8px");
    const { result, rerender } = renderHook(
      ({ stored }) => useLiveDraft(stored),
      { initialProps: { stored: state.stored } }
    );
    act(() => result.current.type("24", write));
    rerender({ stored: "24px" });
    expect(result.current.written("24")).toBe(true);
    // Refused on the way to a unit: still the last written one.
    act(() => result.current.type("24p", () => false));
    expect(result.current.written("24p")).toBe(false);
    act(() => result.current.type("24", () => false));
    act(() => result.current.end());
    expect(result.current.draft).toBe("24px");
    expect(result.current.written("24")).toBe(false);
  });

  it("forgets what it wrote once the value moves under it", () => {
    const { state, write } = storedValue("1");
    const { result, rerender } = renderHook(
      ({ stored }) => useLiveDraft(stored),
      { initialProps: { stored: state.stored } }
    );
    act(() => result.current.type("2", write));
    rerender({ stored: "2" });
    rerender({ stored: "1" });
    expect(result.current.written("2")).toBe(false);
  });
});
