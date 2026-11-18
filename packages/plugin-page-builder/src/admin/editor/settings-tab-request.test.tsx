// @vitest-environment jsdom

/**
 * Opening Page settings at a tab: the tab asked for is opened with it and
 * taken once, as the dialog's first tab; each close is counted.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSettingsTabRequestState } from "./settings-tab-request";

describe("the settings tab request", () => {
  it("opens Page settings and hands the tab asked for to the dialog, once", () => {
    const openSettings = vi.fn();
    const { result } = renderHook(() =>
      useSettingsTabRequestState(openSettings)
    );
    act(() => result.current.ask("seo-tab"));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(result.current.take()).toBe("seo-tab");
    // Opened again some other way, the dialog starts on its first tab.
    expect(result.current.take()).toBeUndefined();
  });

  it("counts each close of Page settings", () => {
    const { result } = renderHook(() => useSettingsTabRequestState(vi.fn()));
    expect(result.current.closed).toBe(0);
    act(() => result.current.noteClosed());
    act(() => result.current.noteClosed());
    expect(result.current.closed).toBe(2);
  });
});
