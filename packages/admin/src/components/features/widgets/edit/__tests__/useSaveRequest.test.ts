/**
 * A request to save the customised dashboard: an open settings panel's change is saved with the
 * draft on every path to a write, the confirmed replacement of an unreadable arrangement
 * included, and a change the panel refuses stops the save on every path too.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSaveRequest } from "../useSaveRequest";

const panels = vi.hoisted(() => ({
  stagePendingPanels: vi.fn(),
  bringRefusedPanelForward: vi.fn(),
}));
vi.mock("../settings-panel-registry", () => panels);

const STAGED = [
  { placementId: "p1", kept: { config: { heading: "Mine" }, ownTitle: "" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  panels.stagePendingPanels.mockResolvedValue(STAGED);
});

describe("saving over an arrangement the server could not read", () => {
  it("asks first, then saves an open panel's change with the confirmed replacement", async () => {
    const save = vi.fn().mockResolvedValue("saved");
    const { result } = renderHook(() => useSaveRequest(save, true));
    await act(async () => {
      expect(await result.current.request()).toBe(false);
    });
    expect(result.current.askingReplace).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      result.current.confirmReplace();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledWith({
      replaceUnreadable: true,
      staged: [
        { placementId: "p1", config: { heading: "Mine" }, ownTitle: "" },
      ],
    });
  });

  it("writes nothing on the confirmed replacement while the panel refuses its change", async () => {
    panels.stagePendingPanels.mockResolvedValue("invalid");
    const save = vi.fn().mockResolvedValue("saved");
    const { result } = renderHook(() => useSaveRequest(save, true));
    await act(async () => {
      result.current.confirmReplace();
      await Promise.resolve();
    });
    expect(save).not.toHaveBeenCalled();
    expect(panels.bringRefusedPanelForward).toHaveBeenCalledTimes(1);
  });
});
