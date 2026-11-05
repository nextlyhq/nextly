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
        w: 12,
        h: 3,
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
      { id: "a", widgetId: "w/a", w: 6, h: 3, removed: false },
      { id: "b", widgetId: "w/b", w: 6, h: 3, removed: true },
    ];
    expect((await saveDraft(placements)).placements).toEqual(placements);
  });
});

describe("staging a reset", () => {
  const card = (widgetId: string): WidgetPlacement => ({
    id: widgetId,
    widgetId,
    w: 12,
    h: 3,
    removed: false,
  });
  const draft: LayoutDraft = {
    placements: [card("core/team")],
    version: 7,
    scope: "user",
    stagedReset: null,
  };
  function staging(read: Record<string, unknown>) {
    let staged: LayoutDraft | null = draft;
    const setDraft = vi.fn(
      (
        next:
          | LayoutDraft
          | null
          | ((c: LayoutDraft | null) => LayoutDraft | null)
      ) => {
        staged = typeof next === "function" ? next(staged) : next;
      }
    );
    const layout = { layout: read } as unknown as UseDashboardLayoutResult;
    const { result } = renderHook(() =>
      useLayoutLifecycle(layout, draft, setDraft)
    );
    return {
      stage: () => result.current.stageReset(),
      staged: () => staged,
    };
  }

  it("stages this read's default at once, asking for nothing more", () => {
    // The setup card is placed or left out by its own rules in the default
    // the read answers, so the reset lands on exactly that default.
    const { stage, staged } = staging({
      defaultPlacements: [card("core/setup"), card("core/team")],
    });
    act(() => stage());
    expect(staged()?.stagedReset?.map(p => p.widgetId)).toEqual([
      "core/setup",
      "core/team",
    ]);
  });
});
