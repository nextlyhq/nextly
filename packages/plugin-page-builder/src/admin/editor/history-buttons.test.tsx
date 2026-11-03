// @vitest-environment jsdom
/**
 * The top bar's undo and redo: one step of the document's history each, after
 * any open inline edit has been committed into it.
 *
 * @module admin/editor/history-buttons.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { InlineEditOutcome } from "@nextlyhq/builder/shell";

import { HistoryButtons } from "./history-buttons";

afterEach(cleanup);

function mount(
  state: { canUndo: boolean; canRedo: boolean },
  calls: string[] = [],
  open: {
    status?: InlineEditOutcome["status"];
    editing?: unknown;
    editingRich?: unknown;
    inspecting?: boolean;
  } = {}
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
          return { status: open.status ?? "unchanged" } as InlineEditOutcome;
        },
        editing: open.editing ?? null,
        editingRich: open.editingRich ?? null,
        inspecting: open.inspecting ?? false,
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

  it("offers Undo for an open inline edit on a fresh document", () => {
    // The edit is not in the history yet, and Undo is what commits it and
    // takes it back.
    const calls = mount({ canUndo: false, canRedo: false }, [], {
      status: "written",
      editing: { nodeId: "a" },
    });
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button("Undo"));
    expect(calls).toEqual(["commit", "undo"]);
  });

  it("offers Undo for a passage open in an inspector field", () => {
    // Undo commits it first, so it is the step taken back.
    mount({ canUndo: false, canRedo: false }, [], { inspecting: true });
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers Undo for an open rich text passage too", () => {
    mount({ canUndo: false, canRedo: false }, [], {
      editingRich: { nodeId: "a" },
    });
    expect((button("Undo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves the history alone when the inline edit is refused and stays open", () => {
    // Its words exist nowhere else: stepping the history underneath them
    // would leave the passage unable to commit.
    for (const status of ["refused", "unavailable"] as const) {
      cleanup();
      const calls = mount({ canUndo: true, canRedo: true }, [], { status });
      fireEvent.click(button("Undo"));
      fireEvent.click(button("Redo"));
      expect(calls).toEqual(["commit", "commit"]);
    }
  });

  it("does not redo once the inline edit becomes a new step", () => {
    // A new step ends the branch Redo would replay.
    const calls = mount({ canUndo: true, canRedo: true }, [], {
      status: "written",
    });
    fireEvent.click(button("Redo"));
    expect(calls).toEqual(["commit"]);
  });

  it("redoes when the inline edit changed nothing", () => {
    const calls = mount({ canUndo: true, canRedo: true }, [], {
      status: "discarded",
    });
    fireEvent.click(button("Redo"));
    expect(calls).toEqual(["commit", "redo"]);
  });

  it("names only the action until the platform's keys are known", () => {
    // What a server render emits, so the browser's first render matches it.
    const html = renderToString(
      <HistoryButtons
        editor={{
          canUndo: true,
          canRedo: true,
          undo: () => undefined,
          redo: () => undefined,
        }}
        inline={{
          commit: () => ({ status: "unchanged" }) as InlineEditOutcome,
          editing: null,
          editingRich: null,
        }}
      />
    );
    expect(html).toContain('title="Undo"');
    expect(html).toContain('title="Redo"');
  });
});
