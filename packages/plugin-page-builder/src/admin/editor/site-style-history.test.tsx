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

/** The site style's read, as the editor's query holds it. */
const refetch = vi.fn(() => Promise.resolve());
let read: { data: unknown; refetch: () => Promise<void> } = {
  data: { tokens: null },
  refetch,
};
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useSingleDocument: () => read,
}));

const { useSiteStyleHistory } = await import("./site-style-history");

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
  refetch.mockClear();
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
});
