// @vitest-environment jsdom
/**
 * A page with none of its own, on a set's screen: every edit of it is refused
 * with the words given, whichever surface asked, and nothing else of its
 * state changes. Any other page is edited as always.
 */
import type { EditorState } from "@nextlyhq/builder/shell";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePagelessGuard } from "./use-editor-mount";

function state(): EditorState {
  return {
    apply: vi.fn(() => ({ formatVersion: 1, kind: "page", nodes: [] })),
    applyAll: vi.fn(() => ({ formatVersion: 1, kind: "page", nodes: [] })),
    select: vi.fn(),
  } as unknown as EditorState;
}

describe("a page with none of its own", () => {
  it("refuses every edit of it, saying why, and applies nothing", () => {
    const page = state();
    const raise = vi.fn();
    const { result } = renderHook(() =>
      usePagelessGuard(page, { sentence: "No page here.", raise })
    );
    expect(result.current.apply({} as never)).toBeNull();
    expect(result.current.applyAll([])).toBeNull();
    expect(raise).toHaveBeenCalledTimes(2);
    expect(raise).toHaveBeenCalledWith("No page here.");
    expect(page.apply).not.toHaveBeenCalled();
    expect(page.applyAll).not.toHaveBeenCalled();
    // Selection is the state's own.
    expect(result.current.select).toBe(page.select);
  });

  it("leaves any other page as it is", () => {
    const page = state();
    const { result } = renderHook(() => usePagelessGuard(page, undefined));
    expect(result.current).toBe(page);
  });
});
