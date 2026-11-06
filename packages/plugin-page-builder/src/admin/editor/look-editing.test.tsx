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
    expect(result.current.id).toBeNull();

    act(() => result.current.edit("look:core/button:primary"));
    expect(select).toHaveBeenCalledWith(null);
    expect(result.current.id).toBe("look:core/button:primary");

    act(() => result.current.exit());
    expect(result.current.id).toBeNull();
  });

  it("leaves the look when a block is selected", () => {
    const select = vi.fn();
    const { result, rerender } = renderHook(
      ({ selectedId }: { selectedId: string | null }) =>
        useLookEditing({ selectedId, select }),
      { initialProps: { selectedId: null } }
    );
    act(() => result.current.edit("look:core/button:outline"));
    expect(result.current.id).toBe("look:core/button:outline");

    rerender({ selectedId: "a" });
    expect(result.current.id).toBeNull();
  });
});
