/**
 * A form held on a change the lock told of refused no write: it has nothing
 * to save anyway with, and a failure to keep its edits is said where the
 * change was told, never by a conflict dialog offering an empty overwrite.
 */
import { describe, expect, it } from "vitest";

import { act, renderHook } from "@admin/__tests__/utils";

import { useVersionConflict } from "../useVersionConflict";

const stale = {
  currentVersion: "4",
  changedBy: { kind: "person" as const, name: "Ana" },
  changedAt: "2026-11-05T10:42:00.000Z",
};

/** The refusal of a save made from an older version, as the fetcher throws it. */
const refusal = Object.assign(new Error("This document changed."), {
  status: 409,
  code: "STALE_VERSION",
  data: stale,
});

describe("a form held on someone else's change", () => {
  it("has nothing to save anyway with, and opens no dialog when its edits cannot be kept", () => {
    const { result } = renderHook(() => useVersionConflict());
    act(() => result.current.holdForChange(stale as never));

    expect(result.current.pinned()).toBe(true);
    // 🔴 An overwrite from here would save none of the edits on screen.
    expect(result.current.overwrite()).toBeNull();
    act(() => result.current.failed("The edits could not be kept."));
    expect(result.current.conflict).toBeNull();
  });

  it("still offers a refused save's own write, and says its failure in the dialog", () => {
    const { result } = renderHook(() => useVersionConflict());
    act(() => {
      result.current.writeFor().refused(refusal, { title: "Mine", _rev: "3" });
    });

    expect(result.current.overwrite()).toMatchObject({
      title: "Mine",
      _overwrite: true,
    });
    act(() => result.current.failed("The edits could not be kept."));
    expect(result.current.conflict).toMatchObject({
      failure: "The edits could not be kept.",
    });
  });
});
