/**
 * When the analysis cannot be loaded, the workbench says blanks aren't
 * checked rather than reading as though every value were there.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useTemplateVariables } from "../useTemplateVariables";

vi.mock("../liquid/liquid-variables", () => {
  throw new Error("the chunk did not load");
});

const unhandled = vi.fn();
beforeEach(() => {
  unhandled.mockReset();
  process.on("unhandledRejection", unhandled);
});
afterEach(() => {
  process.off("unhandledRejection", unhandled);
});

const EMPTY: Record<string, unknown> = {};

it("says blanks could not be checked, still lists plain variables, and leaves no rejection behind", async () => {
  const { result } = renderHook(() =>
    useTemplateVariables({
      sources: ["{{ who }}"],
      declared: [],
      data: EMPTY,
      isLayoutRow: false,
      liquid: true,
    })
  );
  await waitFor(() => expect(result.current.blanks).toBe("unavailable"));
  expect(result.current.undeclared).toEqual([{ name: "who", paths: ["who"] }]);
  expect(result.current.missing).toEqual([]);
  // A rejection nobody handles is reported after the turn it happened in.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(unhandled).not.toHaveBeenCalled();
});
