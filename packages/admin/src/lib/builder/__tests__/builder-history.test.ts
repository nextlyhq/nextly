/**
 * The Builder's undo history: states of the definition, not a log of
 * actions. Undo and redo step between them; a new edit drops what could
 * have been redone; one field's edits in a row are one step, so typing a
 * label is undone at once.
 */
import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  currentState,
  redo,
  undo,
} from "../builder-history";

describe("builder history", () => {
  it("steps back and forward through the states", () => {
    let history = createHistory("a");
    history = commit(history, "b");
    history = commit(history, "c");
    expect(currentState(history)).toBe("c");
    history = undo(history);
    expect(currentState(history)).toBe("b");
    history = undo(history);
    expect(currentState(history)).toBe("a");
    expect(canUndo(history)).toBe(false);
    history = redo(history);
    history = redo(history);
    expect(currentState(history)).toBe("c");
    expect(canRedo(history)).toBe(false);
  });

  it("undo at the start and redo at the end change nothing", () => {
    const start = createHistory("a");
    expect(undo(start)).toBe(start);
    const end = commit(start, "b");
    expect(redo(end)).toBe(end);
  });

  it("a new edit after an undo drops what could have been redone", () => {
    let history = commit(commit(createHistory("a"), "b"), "c");
    history = undo(history);
    history = commit(history, "d");
    expect(currentState(history)).toBe("d");
    expect(canRedo(history)).toBe(false);
    history = undo(history);
    expect(currentState(history)).toBe("b");
  });

  it("edits with one key in a row are one step", () => {
    let history = createHistory("");
    for (const typed of ["H", "He", "Hea", "Head"]) {
      history = commit(history, typed, "label:title");
    }
    expect(currentState(history)).toBe("Head");
    history = undo(history);
    expect(currentState(history)).toBe("");
  });

  it("another key, or an edit with none, starts a new step", () => {
    let history = createHistory("");
    history = commit(history, "a", "label:title");
    history = commit(history, "ab", "label:summary");
    history = commit(history, "abc");
    history = commit(history, "abcd");
    expect(undo(history).states.length).toBe(5);
    expect(currentState(undo(history))).toBe("abc");
    expect(currentState(undo(undo(history)))).toBe("ab");
  });

  it("an undo ends a step: the same key afterwards starts a new one", () => {
    let history = createHistory("");
    history = commit(history, "a", "label:title");
    history = commit(history, "ab", "other");
    history = undo(history);
    history = commit(history, "ax", "label:title");
    history = commit(history, "axy", "label:title");
    expect(currentState(undo(history))).toBe("a");
  });

  it("an edit that changes nothing is no step", () => {
    const history = commit(createHistory("a"), "b");
    expect(commit(history, "b")).toBe(history);
  });

  it("keeps at most its limit of steps, dropping the oldest", () => {
    let history = createHistory(0, 3);
    for (let n = 1; n <= 5; n += 1) history = commit(history, n);
    expect(history.states).toEqual([2, 3, 4, 5]);
    history = undo(undo(undo(history)));
    expect(currentState(history)).toBe(2);
    expect(canUndo(history)).toBe(false);
  });
});
