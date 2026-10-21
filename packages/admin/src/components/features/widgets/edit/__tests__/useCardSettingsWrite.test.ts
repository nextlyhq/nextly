/**
 * Saving one card's settings outside customise mode: what is sent, when the caller is told it
 * landed, and what a refused or unreadable write does instead.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@admin/components/ui", () => ({ toast: { error: toastError } }));

import { useCardSettingsWrite } from "../useCardSettingsWrite";

const PLACEMENTS: WidgetPlacement[] = [
  { id: "p1", widgetId: "core/a", width: "half", removed: false },
  { id: "p2", widgetId: "core/b", width: "half", removed: false },
];

function stored(placements = PLACEMENTS): DashboardLayoutResponse {
  return {
    placements,
    widgets: {},
    available: [],
    defaultPlacements: [],
    version: 3,
    source: "default",
    scope: "s",
    audience: "aud",
  } as DashboardLayoutResponse;
}

/**
 * A layout whose `cardSettings` write succeeds or fails as told, and whose cache then holds
 * what the server would have answered.
 */
function fakeLayout(
  outcome: "ok" | "conflict" | "lost" = "ok",
  patch: Partial<UseDashboardLayoutResult> = {}
) {
  let cache: DashboardLayoutResponse = stored();
  const mutate = vi.fn(
    (
      input: { placements: WidgetPlacement[] },
      options: { onSuccess?: () => void; onError?: (error: Error) => void }
    ) => {
      if (outcome === "conflict") {
        options.onError?.(
          Object.assign(new Error("Conflict"), { status: 409 })
        );
        return;
      }
      // "lost": the server accepted it, and the re-read that fills the cache did not land.
      if (outcome === "ok") cache = stored(input.placements);
      options.onSuccess?.();
    }
  );
  const layout = {
    layout: stored(),
    isUnreadable: false,
    isWriting: false,
    cached: () => cache,
    reload: vi.fn(() => Promise.resolve()),
    cardSettings: { mutate, reset: vi.fn(), isPending: false },
    ...patch,
  } as unknown as UseDashboardLayoutResult;
  return { layout, mutate };
}

beforeEach(() => vi.clearAllMocks());

describe("saving a card's settings outside customise mode", () => {
  it("sends the whole arrangement with only that card's settings changed, not arranged", () => {
    const { layout, mutate } = fakeLayout();
    const { result } = renderHook(() => useCardSettingsWrite(layout));
    const onLanded = vi.fn();
    act(() =>
      result.current.write(
        { placementId: "p2", title: "B", config: { limit: 7 } },
        { onLanded }
      )
    );
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      placements: [PLACEMENTS[0], { ...PLACEMENTS[1], config: { limit: 7 } }],
      version: 3,
      scope: "s",
      arranged: false,
    });
    expect(onLanded).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reads the dashboard again and says nothing was saved when the write lost a race", () => {
    const { layout } = fakeLayout("conflict");
    const { result } = renderHook(() => useCardSettingsWrite(layout));
    const onLanded = vi.fn();
    const onFailed = vi.fn();
    act(() =>
      result.current.write(
        { placementId: "p1", title: "A", config: { limit: 7 } },
        { onLanded, onFailed }
      )
    );
    expect(layout.reload).toHaveBeenCalledTimes(1);
    expect(onLanded).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(
      "A changed elsewhere, so this change was not saved."
    );
  });

  it("does not report a write as landed when the dashboard it holds does not show it", () => {
    const { layout } = fakeLayout("lost");
    const { result } = renderHook(() => useCardSettingsWrite(layout));
    const onLanded = vi.fn();
    act(() =>
      result.current.write(
        { placementId: "p1", title: "A", config: { limit: 7 } },
        { onLanded }
      )
    );
    expect(onLanded).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("could not be refreshed")
    );
  });

  it("sends nothing, and says why, while the saved dashboard cannot be read", () => {
    const { layout, mutate } = fakeLayout("ok", { isUnreadable: true });
    const { result } = renderHook(() => useCardSettingsWrite(layout));
    expect(result.current.unavailable).toMatch(/cannot be read/);
    act(() =>
      result.current.write({ placementId: "p1", title: "A", config: {} })
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends nothing while another layout write is in flight", () => {
    const { layout, mutate } = fakeLayout("ok", { isWriting: true });
    const { result } = renderHook(() => useCardSettingsWrite(layout));
    act(() =>
      result.current.write({ placementId: "p1", title: "A", config: {} })
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});
