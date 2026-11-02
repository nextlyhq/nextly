// @vitest-environment jsdom
/**
 * The editor's side of undoing a shared style change: steps join the history
 * the editor connects, replaying one remounts the Design panel's open tab, and
 * a replay the server refuses is said out loud.
 *
 * @module admin/editor/site-style-history.test
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("@nextlyhq/ui", () => ({ toast: { error: toastError } }));

const { useSiteStyleHistory } = await import("./site-style-history");

type Step = { undo: () => Promise<boolean>; redo: () => Promise<boolean> };

const step = (stored: boolean): Step => ({
  undo: () => Promise.resolve(stored),
  redo: () => Promise.resolve(stored),
});

beforeEach(() => toastError.mockReset());

describe("useSiteStyleHistory", () => {
  it("hands a step to the history the editor connected", () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: Step[] = [];
    act(() => result.current.connect(s => recorded.push(s)));
    act(() => result.current.history.record(step(true)));
    expect(recorded).toHaveLength(1);
  });

  it("records nothing before an editor connects, or after it leaves", () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    act(() => result.current.history.record(step(true)));
    const recorded: Step[] = [];
    act(() => result.current.connect(s => recorded.push(s)));
    act(() => result.current.connect(null));
    act(() => result.current.history.record(step(true)));
    expect(recorded).toEqual([]);
  });

  it("moves the revision on when a step is undone or redone", async () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: Step[] = [];
    act(() => result.current.connect(s => recorded.push(s)));
    act(() => result.current.history.record(step(true)));
    const before = result.current.revision;
    await act(async () => {
      await recorded[0]?.undo();
    });
    expect(result.current.revision).toBe(before + 1);
    await act(async () => {
      await recorded[0]?.redo();
    });
    expect(result.current.revision).toBe(before + 2);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says so when the write taking a change back is refused", async () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: Step[] = [];
    act(() => result.current.connect(s => recorded.push(s)));
    act(() => result.current.history.record(step(false)));
    let undone: boolean | undefined;
    await act(async () => {
      undone = await recorded[0]?.undo();
    });
    expect(undone).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      "That style change could not be undone, so it stays as it is."
    );
  });
});
