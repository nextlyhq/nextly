// @vitest-environment jsdom
/**
 * The top bar's undo and redo: one step of the document's history each, after
 * any open inline edit has been committed into it.
 *
 * @module admin/editor/history-buttons.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryButtons } from "./history-buttons";

afterEach(cleanup);

function mount(
  state: { canUndo: boolean; canRedo: boolean },
  calls: string[] = []
) {
  render(
    <HistoryButtons
      editor={{
        ...state,
        undo: () => calls.push("undo"),
        redo: () => calls.push("redo"),
      }}
      inline={{
        commit: () => {
          calls.push("commit");
          return { status: "none" } as never;
        },
      }}
    />
  );
  return calls;
}

const button = (name: string) => screen.getByRole("button", { name });

describe("HistoryButtons", () => {
  it("offers undo and redo only when there is a step to take", () => {
    mount({ canUndo: false, canRedo: false });
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Redo") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mount({ canUndo: true, canRedo: true });
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(false);
    expect((button("Redo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("commits an open inline edit before undoing, so the edit is the step undone", () => {
    // Without the commit, the words still in the caret's element are not yet
    // a step in the history: undo would rewind the change before them, and
    // the author would lose that and keep the words.
    const calls = mount({ canUndo: true, canRedo: false });
    fireEvent.click(button("Undo"));
    expect(calls).toEqual(["commit", "undo"]);
  });

  it("commits an open inline edit before redoing too", () => {
    const calls = mount({ canUndo: false, canRedo: true });
    fireEvent.click(button("Redo"));
    expect(calls).toEqual(["commit", "redo"]);
  });

  it("names each button and its key in the tooltip", () => {
    mount({ canUndo: true, canRedo: true });
    expect(button("Undo").getAttribute("title")).toMatch(/^Undo \(.+Z\)$/);
    expect(button("Redo").getAttribute("title")).toMatch(/^Redo \(.+\)$/);
  });
});
