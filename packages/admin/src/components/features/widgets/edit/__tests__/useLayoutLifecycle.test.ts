/**
 * What Save actually sends.
 *
 * The trimming rule has its own tests beside the editor's other rules; these
 * watch the write it feeds, so a save that sent the draft untrimmed -- and left
 * an over-limit dashboard refused on every save -- fails here.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import type { LayoutDraft } from "../useLayoutEditor";
import { useLayoutLifecycle } from "../useLayoutLifecycle";

import { layoutSizeProblem } from "nextly/config";

/** The layout hook's two writes, recorded; nothing else is reached by Save. */
function layoutWrites() {
  const save = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
  const reset = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  };
  // Only the members Save and Cancel touch. A fixture of the whole result
  // would be a second description of the hook that drifts from it.
  const layout = {
    layout: undefined,
    save,
    reset,
  } as unknown as UseDashboardLayoutResult;
  return { layout, save, reset };
}

async function saveDraft(placements: WidgetPlacement[]) {
  const { layout, save } = layoutWrites();
  const draft: LayoutDraft = {
    placements,
    version: 7,
    scope: "user",
    stagedReset: null,
  };
  const { result } = renderHook(() =>
    useLayoutLifecycle(layout, draft, vi.fn())
  );
  await act(async () => {
    await result.current.save();
  });
  expect(save.mutateAsync).toHaveBeenCalledTimes(1);
  return save.mutateAsync.mock.calls[0][0] as {
    placements: WidgetPlacement[];
  };
}

describe("saving a customised dashboard", () => {
  it("sends a save the endpoint would refuse trimmed to one it accepts", async () => {
    // Forty cards, the removed half carrying large settings: under the count
    // but over the endpoint's byte limit, so the draft as it stands is
    // refused. The cards on the dashboard fit on their own.
    const big = { note: "x".repeat(2_000) };
    const placements: WidgetPlacement[] = Array.from(
      { length: 40 },
      (_, i) => ({
        id: `p${i}`,
        widgetId: `w/${i}`,
        width: "full",
        removed: i % 2 === 0,
        ...(i % 2 === 0 ? { config: big } : {}),
      })
    );
    expect(layoutSizeProblem(placements)).toBeDefined();

    const sent = (await saveDraft(placements)).placements;
    expect(layoutSizeProblem(sent)).toBeUndefined();
    // Nothing on the dashboard is left out, and nothing the draft lacked is
    // added.
    expect(sent.filter(p => !p.removed)).toEqual(
      placements.filter(p => !p.removed)
    );
    expect(sent.every(p => placements.includes(p))).toBe(true);
  });

  it("sends a save that fits exactly as the draft holds it", async () => {
    const placements: WidgetPlacement[] = [
      { id: "a", widgetId: "w/a", width: "half", removed: false },
      { id: "b", widgetId: "w/b", width: "half", removed: true },
    ];
    expect((await saveDraft(placements)).placements).toEqual(placements);
  });
});
