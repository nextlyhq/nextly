// @vitest-environment jsdom
/**
 * Which look the inspector edits on its own: chosen from the Design panel,
 * left by the way back, and left by selecting a block.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLookEditing } from "./look-editing";

describe("editing a look on its own", () => {
  it("leaves the selected block when a look is chosen, and goes back on exit", () => {
    const select = vi.fn();
    const { result } = renderHook(() =>
      useLookEditing({ selectedId: null, select })
    );
    expect(result.current.look).toBeNull();

    act(() =>
      result.current.edit({
        id: "look:core/button:primary",
        blockType: "core/button",
      })
    );
    expect(select).toHaveBeenCalledWith(null);
    expect(result.current.look).toEqual({
      id: "look:core/button:primary",
      blockType: "core/button",
    });

    act(() => result.current.exit());
    expect(result.current.look).toBeNull();
  });

  it("leaves the look when a block is selected", () => {
    const select = vi.fn();
    const { result, rerender } = renderHook(
      ({ selectedId }: { selectedId: string | null }) =>
        useLookEditing({ selectedId, select }),
      { initialProps: { selectedId: null } }
    );
    act(() =>
      result.current.edit({
        id: "look:core/button:outline",
        blockType: "core/button",
      })
    );
    expect(result.current.look?.id).toBe("look:core/button:outline");

    rerender({ selectedId: "a" });
    expect(result.current.look).toBeNull();
  });
});
