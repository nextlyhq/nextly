/**
 * What counts as one unsaved change, what Undo takes back, and what a save
 * leaves unsaved.
 */
import { describe, expect, it } from "vitest";

import {
  beginSaving,
  COALESCE_MS,
  emptyHistory,
  markSaved,
  recordChange,
  undoChange,
  type ChangeHistory,
} from "./change-history";

/** A form as history sees it: any value, compared by identity. */
const form = (name: string) => ({ name });
type Form = ReturnType<typeof form>;

/** The history after each `[before, key, at]` change in turn. */
function changes(
  steps: [Form, string | null, number][],
  start: ChangeHistory<Form> = emptyHistory()
): ChangeHistory<Form> {
  return steps.reduce(
    (history, [before, key, at]) => recordChange(history, before, key, at),
    start
  );
}

describe("recordChange", () => {
  it("counts keystrokes into one input as one change while they keep coming", () => {
    const a = form("a");
    const ab = form("ab");
    const abc = form("abc");
    const history = changes([
      [a, "form:name", 1000],
      [ab, "form:name", 1000 + COALESCE_MS - 1],
      [abc, "form:name", 1000 + 2 * COALESCE_MS - 2],
    ]);
    // One change, and Undo goes back to before the first keystroke.
    expect(history.entries).toEqual([a]);
  });

  it("starts a new change after a pause, or on another input", () => {
    const a = form("a");
    const b = form("b");
    const c = form("c");
    expect(
      changes([
        [a, "form:name", 1000],
        [b, "form:name", 1000 + COALESCE_MS],
        [c, "form:slug", 1000 + COALESCE_MS + 1],
      ]).entries
    ).toEqual([a, b, c]);
  });

  it("never joins a change that names nothing, such as a status picked", () => {
    const a = form("a");
    const b = form("b");
    expect(
      changes([
        [a, null, 1000],
        [b, null, 1001],
      ]).entries
    ).toEqual([a, b]);
  });

  it("counts two writes from one event once", () => {
    // The same record twice is the same form as the event found it: a name
    // and the ID it suggests, written together.
    const a = form("a");
    expect(
      changes([
        [a, null, 1000],
        [a, null, 1000],
      ]).entries
    ).toEqual([a]);
  });
});

describe("undoChange", () => {
  it("restores the form before the last change, then the one before", () => {
    const a = form("a");
    const b = form("b");
    const first = undoChange(
      changes([
        [a, null, 1],
        [b, null, 2],
      ])
    );
    expect(first?.restore).toBe(b);
    const second = undoChange(first!.history);
    expect(second?.restore).toBe(a);
    expect(second?.history.entries).toEqual([]);
  });

  it("answers nothing with nothing unsaved", () => {
    expect(undoChange(emptyHistory())).toBeUndefined();
  });

  it("does not join the next edit to the change it took back", () => {
    const a = form("a");
    const b = form("b");
    const undone = undoChange(changes([[a, "form:name", 1000]]))!;
    expect(recordChange(undone.history, b, "form:name", 1001).entries).toEqual([
      b,
    ]);
  });
});

describe("a save", () => {
  it("keeps the changes made while it ran unsaved", () => {
    const a = form("a");
    const b = form("b");
    const c = form("c");
    const begun = beginSaving(
      changes([
        [a, null, 1],
        [b, null, 2],
      ])
    );
    // Made during the save, so not in what it stored.
    const during = recordChange(begun.history, c, null, 3);
    expect(markSaved(during, begun.mark).entries).toEqual([c]);
  });

  it("never joins an edit made during it to one it is storing", () => {
    const a = form("a");
    const b = form("b");
    const begun = beginSaving(changes([[a, "form:name", 1000]]));
    const during = recordChange(begun.history, b, "form:name", 1001);
    expect(markSaved(during, begun.mark).entries).toEqual([b]);
  });

  it("stores everything when its start was not recorded", () => {
    expect(
      markSaved(changes([[form("a"), null, 1]]), undefined).entries
    ).toEqual([]);
  });
});
