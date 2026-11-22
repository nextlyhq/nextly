// @vitest-environment jsdom

/**
 * A look edited on its own and a selected header or footer both take the
 * sidebar, so choosing one leaves the other: the sidebar never shows the
 * region's card over the look the author just chose, or the look over the
 * region they just clicked.
 *
 * @module admin/editor/selected-region.test
 */
import { useRegionSelection } from "@nextlyhq/builder/shell";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useLookEditing } from "./look-editing";
import { useLookBesideRegion } from "./selected-region";

/** An editor with nothing selected, as one is while either is open. */
const editor = { selectedId: null, select: vi.fn() };

function harness() {
  return renderHook(() => {
    const look = useLookEditing(editor);
    const region = useRegionSelection(editor, ["header", "footer"]);
    return useLookBesideRegion(look, region);
  });
}

const aLook = { id: "card", blockType: "acme/card" };

describe("a look and a selected header or footer", () => {
  it("leaves the selected region when a look is chosen", () => {
    const { result } = harness();
    act(() => result.current.selection.select("header"));
    expect(result.current.selection.area).toBe("header");
    act(() => result.current.lookEditing.edit(aLook));
    expect(result.current.lookEditing.look).toBe(aLook);
    expect(result.current.selection.area).toBeNull();
  });

  it("leaves the look when a region is selected", () => {
    const { result } = harness();
    act(() => result.current.lookEditing.edit(aLook));
    act(() => result.current.selection.select("footer"));
    expect(result.current.selection.area).toBe("footer");
    expect(result.current.lookEditing.look).toBeNull();
  });
});
