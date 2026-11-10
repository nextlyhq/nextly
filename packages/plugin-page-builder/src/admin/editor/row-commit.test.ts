import { describe, expect, it, vi } from "vitest";

import { RowCommitRefused, rowGuardedWrite } from "./row-commit";

/**
 * The editor's hand-over into a repeater row's field. The admin answers where
 * the row is now by its saved id (`fieldPathIn`); these cases stand in for
 * that answer and pin what the write does with it.
 */
describe("a write into a repeater row's field", () => {
  it("lands when the row is still where the editor is bound", () => {
    const write = vi.fn();
    const commit = rowGuardedWrite(
      write,
      "sections.1.body",
      () => "sections.1.body"
    );

    commit("layout");

    expect(write).toHaveBeenCalledWith("layout");
  });

  it("is refused, writing nothing, when the row is gone", () => {
    // Removed since the editor opened: the row now at position 1 is another
    // row, and a write by position would put this layout in it.
    const write = vi.fn();
    const commit = rowGuardedWrite(write, "sections.1.body", () => undefined);

    expect(() => commit("layout")).toThrow(RowCommitRefused);
    expect(() => commit("layout")).toThrow(/isn't in the entry any more/);
    expect(write).not.toHaveBeenCalled();
  });

  it("is refused, writing nothing, when the row moved and the editor has not caught up", () => {
    // Reordered: the row is now at position 0, while the editor is still
    // bound at position 1, where another row stands.
    const write = vi.fn();
    const commit = rowGuardedWrite(
      write,
      "sections.1.body",
      () => "sections.0.body"
    );

    expect(() => commit("layout")).toThrow(RowCommitRefused);
    expect(write).not.toHaveBeenCalled();
  });

  it("asks where the row is at the moment of writing, not when it was made", () => {
    let now: string | undefined = "sections.1.body";
    const write = vi.fn();
    const commit = rowGuardedWrite(write, "sections.1.body", () => now);

    now = undefined;

    expect(() => commit("layout")).toThrow(RowCommitRefused);
    expect(write).not.toHaveBeenCalled();
  });

  it("is the field's own write outside a row", () => {
    const write = vi.fn();
    expect(rowGuardedWrite(write, "hero.body", undefined)).toBe(write);
  });
});
