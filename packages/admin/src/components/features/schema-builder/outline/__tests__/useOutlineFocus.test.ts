/**
 * Focus over the outline hands back one object while what it holds is the same, so the row
 * actions built from it are not rebuilt, and every row redrawn, on each drawing of the outline.
 */
import { describe, expect, it } from "vitest";

import { renderHook } from "@admin/__tests__/utils";
import { buildOutline } from "@admin/lib/builder/outline/outline-model";

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
});
