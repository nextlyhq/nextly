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

/** Rows over a list of strings, each its own draft. */
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
    expect(result.current.rows[1]).toMatchObject({
      draft: "second, edited",
      drafted: true,
    });
    // The first row is removed and written: "second" is now row 0.
    rerender({ stored: ["second"] });
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
    rerender({ stored: ["first, written", "second"] });
    expect(result.current.rows[1]).toMatchObject({
      draft: "second, edited",
      drafted: true,
    });
    // CONTROL: its own row written, the draft is what the row now holds.
    rerender({ stored: ["first, written", "second, written"] });
    expect(result.current.rows[1]).toMatchObject({
      draft: "second, written",
      drafted: false,
    });
  });
});
