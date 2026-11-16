// @vitest-environment jsdom
/**
 * The editor's side of undoing a shared style change: steps join the history
 * the editor connects, replaying one remounts the Design panel's open tab, and
 * a replay the server refuses is said out loud.
 *
 * @module admin/editor/site-style-history.test
 */
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("@nextlyhq/ui", () => ({
  toast: { error: toastError, warning: toastWarning },
}));

/**
 * The site style's read, as the editor's query on the plugin's route holds
 * it: the one read the canvas draws from, so the one a replay waits for.
 */
const refetch = vi.fn(() => Promise.resolve({ isError: false }));
let read: { data: unknown; refetch: () => Promise<{ isError: boolean }> } = {
  data: { tokens: null },
  refetch,
};
vi.mock("../site-style-read", () => ({
  useStoredSiteStyle: () => read,
}));

/**
 * What the Single was asked to store, in order. Each write is saved over
 * whatever the style holds and says so with `_overwrite: true`, which the
 * expectations state.
 */
const singleWrites: Record<string, unknown>[] = [];
// No `useSingleDocument`: the editor reads the style only through the route,
// so a read of the Single fails here.
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useUpdateSingleDocument: () => ({
    mutateAsync: async (data: Record<string, unknown>) => {
      singleWrites.push(data);
      return { id: "1" };
    },
    isPending: false,
  }),
  validationIssues: () => [],
  readPluginRoute: async () => undefined,
  writePluginRoute: async () => undefined,
  // Outside a document editor, where there is no Save to run before.
  useBeforeDocumentAction: () => {},
  // The form's storing gate, absent here: nothing is tracked.
  useTrackedWrite: () => () => {},
}));

const { useSiteStyleHistory } = await import("./site-style-history");
const { SiteStyleHistoryContext, useSaveSiteStyle } = await import(
  "../site-style-client"
);

/** What a step's half came to, as the site style client reports it. */
type Outcome = { stored: boolean; section: "tokens"; value: unknown };
type Step = { undo: () => Promise<Outcome>; redo: () => Promise<Outcome> };
/** What the editor's history is handed: each half answers whether it took. */
type EditorStep = {
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
};

/** A history that keeps what it is handed, and withdraws nothing. */
const record = (into: EditorStep[]) => (s: EditorStep) => {
  into.push(s);
  return () => {};
};

/** The value a replay writes to the tokens section. */
const REPLAYED = { tokens: [] };

const step = (stored: boolean): Step => ({
  undo: () => Promise.resolve({ stored, section: "tokens", value: REPLAYED }),
  redo: () => Promise.resolve({ stored, section: "tokens", value: REPLAYED }),
});

beforeEach(() => {
  toastError.mockReset();
  toastWarning.mockReset();
  refetch.mockClear();
  singleWrites.length = 0;
  read = { data: { tokens: null }, refetch };
});

describe("useSiteStyleHistory", () => {
  it("hands a step to the history the editor connected", () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: EditorStep[] = [];
    act(() => result.current.connect(record(recorded)));
    act(() => result.current.history.record(step(true)));
    expect(recorded).toHaveLength(1);
  });

  it("records nothing before an editor connects, or after it leaves", () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    act(() => result.current.history.record(step(true)));
    const recorded: EditorStep[] = [];
    act(() => result.current.connect(record(recorded)));
    act(() => result.current.connect(null));
    act(() => result.current.history.record(step(true)));
    expect(recorded).toEqual([]);
  });

  it("moves the revision on once the replayed value has been read back", async () => {
    // The write invalidates the read rather than updating it: remounting
    // before the read catches up would show the value the replay replaced.
    const { result, rerender } = renderHook(() => useSiteStyleHistory());
    const recorded: EditorStep[] = [];
    act(() => result.current.connect(record(recorded)));
    act(() => result.current.history.record(step(true)));
    const before = result.current.replay.revision;
    await act(async () => {
      await recorded[0]?.undo();
    });
    expect(result.current.replay.revision).toBe(before);
    expect(result.current.replay.settling).toBe(true);

    // A read that does not hold the replayed value yet changes nothing.
    read = { data: { tokens: { tokens: [{ name: "other" }] } }, refetch };
    rerender();
    expect(result.current.replay.revision).toBe(before);
    read = { data: { tokens: REPLAYED }, refetch };
    rerender();
    expect(result.current.replay.revision).toBe(before + 1);
    expect(result.current.replay.settling).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
    // A replay that met nothing newer says nothing.
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("is settling while a replay is in flight", async () => {
    let answer: (stored: boolean) => void = () => {};
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: EditorStep[] = [];
    act(() => result.current.connect(record(recorded)));
    act(() =>
      result.current.history.record({
        undo: () =>
          new Promise<Outcome>(resolve => {
            answer = stored =>
              resolve({ stored, section: "tokens", value: REPLAYED });
          }),
        redo: () =>
          Promise.resolve({ stored: true, section: "tokens", value: REPLAYED }),
      })
    );
    let undoing: Promise<boolean> | undefined;
    act(() => {
      undoing = recorded[0]?.undo();
    });
    expect(result.current.replay.settling).toBe(true);
    await act(async () => {
      answer(false);
      await undoing;
    });
    // Refused: nothing changed, so nothing waits for a read.
    expect(result.current.replay.settling).toBe(false);
  });

  it("says where an undo or redo met a change made since, and kept it", async () => {
    // Stored, but the merge kept theirs for Brand: that part could not be
    // taken back, or put forward again, and the author is told which.
    const brand = {
      name: "color.brand",
      kind: "color",
      values: { light: "#1" },
    };
    const conflicts = {
      entries: [
        {
          key: "color.brand",
          setting: false,
          kind: "changed" as const,
          kept: "theirs" as const,
          base: brand,
          mine: { ...brand, values: { light: "#2" } },
          theirs: { ...brand, values: { light: "#3" } },
        },
      ],
      refusal: { changedBy: { name: "Sam" }, oneSaveBetween: true },
    };
    const half = () =>
      Promise.resolve({
        stored: true,
        section: "tokens" as const,
        value: REPLAYED,
        conflicts,
      });
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: EditorStep[] = [];
    act(() => result.current.connect(record(recorded)));
    act(() => result.current.history.record({ undo: half, redo: half }));
    await act(async () => {
      await recorded[0]?.undo();
    });
    expect(toastWarning).toHaveBeenLastCalledWith(
      "Sam changed Brand since, so your change to it could not be undone."
    );
    await act(async () => {
      await recorded[0]?.redo();
    });
    expect(toastWarning).toHaveBeenLastCalledWith(
      "Sam changed Brand since, so your change to it could not be redone."
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says so when the write taking a change back is refused", async () => {
    const { result } = renderHook(() => useSiteStyleHistory());
    const recorded: EditorStep[] = [];
    act(() => result.current.connect(record(recorded)));
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

  it("asks for the read again when it is slow, and remounts on that answer", async () => {
    // Never on the read the replay replaced: past the wait, the read is
    // fetched again and the surfaces remount on the server's own answer.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSiteStyleHistory());
      const recorded: EditorStep[] = [];
      act(() => result.current.connect(record(recorded)));
      act(() => result.current.history.record(step(true)));
      const before = result.current.replay.revision;
      await act(async () => {
        await recorded[0]?.undo();
      });
      await act(async () => {
        vi.advanceTimersByTime(4900);
      });
      expect(refetch).not.toHaveBeenCalled();
      expect(result.current.replay.settling).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(200);
        await Promise.resolve();
      });
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(result.current.replay.revision).toBe(before + 1);
      expect(result.current.replay.settling).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays settling when asking for the read again fails, and asks again", async () => {
    // A failed fetch leaves the read the replay replaced: unlocking on it
    // would let the next edit write that value back.
    vi.useFakeTimers();
    try {
      refetch.mockImplementationOnce(() =>
        Promise.reject(new Error("offline"))
      );
      // And a fetch that answers with an error, as a query reports a failure.
      refetch.mockImplementationOnce(() => Promise.resolve({ isError: true }));
      const { result } = renderHook(() => useSiteStyleHistory());
      const recorded: EditorStep[] = [];
      act(() => result.current.connect(record(recorded)));
      act(() => result.current.history.record(step(true)));
      const before = result.current.replay.revision;
      await act(async () => {
        await recorded[0]?.undo();
      });
      await act(async () => {
        vi.advanceTimersByTime(5100);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(result.current.replay.settling).toBe(true);
      expect(result.current.replay.revision).toBe(before);
      await act(async () => {
        vi.advanceTimersByTime(5100);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(refetch).toHaveBeenCalledTimes(2);
      expect(result.current.replay.settling).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(5100);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(refetch).toHaveBeenCalledTimes(3);
      expect(result.current.replay.settling).toBe(false);
      expect(result.current.replay.revision).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a Design writer's save and its undo, through the editor's read", () => {
  it("stores the change, takes it back, and settles once the route's read holds the value", async () => {
    const BEFORE = { tokens: [{ name: "brand" }] };
    const AFTER = { tokens: [{ name: "accent" }] };
    read = { data: { tokens: BEFORE }, refetch };
    const history = renderHook(() => useSiteStyleHistory());
    const recorded: EditorStep[] = [];
    act(() => history.result.current.connect(record(recorded)));
    const value = history.result.current.history;
    const writer = renderHook(() => useSaveSiteStyle(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(SiteStyleHistoryContext.Provider, { value }, children),
    });

    await act(async () => {
      await writer.result.current.save("tokens", AFTER);
    });
    // The Single stored it, and the editor's read was asked again.
    expect(singleWrites).toEqual([{ _overwrite: true, tokens: AFTER }]);
    expect(refetch).toHaveBeenCalledTimes(1);
    read = { data: { tokens: AFTER }, refetch };
    history.rerender();
    writer.rerender();

    const before = history.result.current.replay.revision;
    let undone: boolean | undefined;
    await act(async () => {
      undone = await recorded[0]?.undo();
    });
    expect(undone).toBe(true);
    expect(singleWrites).toEqual([
      { _overwrite: true, tokens: AFTER },
      { _overwrite: true, tokens: BEFORE },
    ]);
    // Waiting on the route's read, which still holds the undone value.
    expect(history.result.current.replay.settling).toBe(true);
    expect(history.result.current.replay.revision).toBe(before);

    read = { data: { tokens: BEFORE }, refetch };
    history.rerender();
    expect(history.result.current.replay.revision).toBe(before + 1);
    expect(history.result.current.replay.settling).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });
});
