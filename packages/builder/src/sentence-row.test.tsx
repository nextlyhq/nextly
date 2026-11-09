// @vitest-environment jsdom

/**
 * The rows of a list being edited: a draft over a stored row stays with that
 * row while other rows are written or removed, and goes once its own row is
 * written. The list filters and the visibility conditions both edit this way.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSentenceRows } from "./sentence-row";

afterEach(cleanup);

/**
 * Rows over a list of strings, each its own draft. A caller writes the stored
 * list in the same event as the row's edit, so a test does both in one `act`:
 * the edit and the list it changed land in one render.
 */
function rowsOver(initial: readonly string[]) {
  return renderHook(
    ({ stored }: { stored: readonly string[] }) =>
      useSentenceRows<string, string>(stored, each => each, ""),
    { initialProps: { stored: initial } }
  );
}

describe("a draft over a stored row", () => {
  it("stays with its row when another row is removed and the rows move up", () => {
    const { result, rerender } = rowsOver(["first", "second"]);
    act(() => {
      result.current.change(result.current.rows[1]!, "second, edited", false);
    });
    act(() => {
      result.current.remove(result.current.rows[0]!);
      rerender({ stored: ["second"] });
    });
    expect(result.current.rows[0]).toMatchObject({
      draft: "second, edited",
      drafted: true,
    });
  });

  it("stays when another row is written, and goes once its own row is", () => {
    const { result, rerender } = rowsOver(["first", "second"]);
    act(() => {
      result.current.change(result.current.rows[1]!, "second, edited", false);
    });
    act(() => {
      result.current.change(result.current.rows[0]!, "first, written", true);
      rerender({ stored: ["first, written", "second"] });
    });
    expect(result.current.rows[1]).toMatchObject({
      draft: "second, edited",
      drafted: true,
    });
    // CONTROL: its own row written, the draft is what the row now holds.
    act(() => {
      result.current.change(result.current.rows[1]!, "second, written", true);
      rerender({ stored: ["first, written", "second, written"] });
    });
    expect(result.current.rows[1]).toMatchObject({
      draft: "second, written",
      drafted: false,
    });
  });

  it("stays with its own row of two that read the same", () => {
    const { result, rerender } = rowsOver(["same", "same"]);
    act(() => {
      result.current.change(result.current.rows[1]!, "same, edited", false);
    });
    act(() => {
      result.current.remove(result.current.rows[0]!);
      rerender({ stored: ["same"] });
    });
    expect(result.current.rows[0]).toMatchObject({
      draft: "same, edited",
      drafted: true,
    });
  });

  it("stays when another row is rewritten in a spelling of its own", () => {
    // A legacy operator canonicalized on the write: the other row's stored
    // text changes, and it is still the same row.
    const { result, rerender } = rowsOver(["eq", "second"]);
    act(() => {
      result.current.change(result.current.rows[1]!, "second, edited", false);
    });
    act(() => {
      result.current.change(result.current.rows[0]!, "equals", true);
      rerender({ stored: ["equals", "second"] });
    });
    expect(result.current.rows[1]).toMatchObject({
      draft: "second, edited",
      drafted: true,
    });
  });

  it("goes with a change made elsewhere, such as an undo, and doesn't come back", () => {
    const { result, rerender } = rowsOver(["first", "second"]);
    act(() => {
      result.current.change(result.current.rows[1]!, "second, edited", false);
    });
    rerender({ stored: ["first", "second, undone"] });
    expect(result.current.rows[1]?.drafted).toBe(false);
    // Redo brings the stored value back; the discarded draft stays gone.
    rerender({ stored: ["first", "second"] });
    expect(result.current.rows[1]).toMatchObject({
      draft: "second",
      drafted: false,
    });
  });

  it("goes with a change made elsewhere after a write that changed nothing", () => {
    const { result, rerender } = rowsOver(["first", "second"]);
    act(() => {
      result.current.change(result.current.rows[1]!, "second, edited", false);
    });
    // Row 1 written back to what it held: the stored list doesn't change.
    act(() => {
      result.current.change(result.current.rows[0]!, "first", true);
    });
    rerender({ stored: ["first", "second"] });
    // CONTROL: the other draft is still there.
    expect(result.current.rows[1]?.drafted).toBe(true);
    // An undo elsewhere is not read as that spent write.
    rerender({ stored: ["first, undone", "second"] });
    expect(result.current.rows[1]?.drafted).toBe(false);
  });
});
