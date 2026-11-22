// @vitest-environment jsdom
/**
 * A run of typing's one step stays as small as the properties the run
 * touched: each keystroke's inverse joins it only for a property the step
 * does not already put back, so a long edit neither grows the step nor
 * replays every keystroke on undo.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BuilderOp } from "@nextlyhq/blocks-engine";

import { useHistoryStacks, type HistoryEntry } from "./editor-history";
import { joinTyping } from "./typing-run";

const inverse = (patch: Record<string, unknown>): HistoryEntry => ({
  kind: "ops",
  ops: [{ kind: "update", id: "t", patch } as BuilderOp],
});

describe("a run of typing's step", () => {
  it("keeps one inverse for a property every keystroke writes", () => {
    const { result } = renderHook(() => useHistoryStacks());
    const run = {};
    let before = "";
    for (const character of "a long sentence typed into one field") {
      const was = before;
      act(() => {
        joinTyping(run, () => {
          result.current.push(inverse({ props: { label: was } }), "new");
        });
      });
      before += character;
    }
    let entry: HistoryEntry | undefined;
    act(() => {
      entry = result.current.pop("undo");
    });
    // The first keystroke's inverse alone: what was there before the run.
    expect(entry).toEqual(inverse({ props: { label: "" } }));
  });

  it("adds a later write's inverse only for the fields it first changed", () => {
    const { result } = renderHook(() => useHistoryStacks());
    const run = {};
    act(() => {
      joinTyping(run, () => {
        result.current.push(inverse({ props: { label: "A" } }), "new");
      });
    });
    act(() => {
      joinTyping(run, () => {
        result.current.push(
          {
            kind: "ops",
            ops: [
              {
                kind: "update",
                id: "t",
                patch: { props: { label: "AB" } },
                unset: ["styles"],
              } as BuilderOp,
            ],
          },
          "new"
        );
      });
    });
    let entry: HistoryEntry | undefined;
    act(() => {
      entry = result.current.pop("undo");
    });
    expect(entry).toEqual({
      kind: "ops",
      // One update of the node: an inverse of the new field alone could
      // change nothing, which the op layer refuses.
      ops: [
        {
          kind: "update",
          id: "t",
          patch: { props: { label: "A" } },
          unset: ["styles"],
        },
      ],
    });
  });
});
