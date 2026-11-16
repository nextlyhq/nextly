/**
 * Focus over the outline hands back one object while what it holds is the same, so the row
 * actions built from it are not rebuilt, and every row redrawn, on each drawing of the outline.
 */
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import {
  buildOutline,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import {
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";
import { useOutlineFocus } from "../useOutlineFocus";

describe("useOutlineFocus", () => {
  it("returns the same object when it is drawn again with the same rows", () => {
    const nodes = buildOutline(nestedFixtureFields(), {
      entityReadOnly: false,
      fieldGroups: nestedFixtureFieldGroups(),
    });
    const { result, rerender } = renderHook(() => useOutlineFocus(nodes));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("asks for keyboard focus when it falls back from a container that went away", () => {
    const whole = buildOutline(nestedFixtureFields(), {
      entityReadOnly: false,
      fieldGroups: nestedFixtureFieldGroups(),
    });
    // The same outline without Meta, as an undo that removed it leaves it.
    const without = whole.filter(node => node.id !== "f-meta");
    const { result, rerender } = renderHook(
      ({ nodes }: { nodes: OutlineNode[] }) => useOutlineFocus(nodes),
      { initialProps: { nodes: whole } }
    );
    act(() => result.current.show("f-meta"));
    result.current.takeReturn(() => false);
    rerender({ nodes: without });
    expect(result.current.view.focused).toBeNull();
    const back = result.current.takeReturn(() => false);
    expect(back.asked).toBe(true);
    expect(back.candidates).toContain("f-meta");
  });
});
