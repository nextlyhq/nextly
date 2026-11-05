/**
 * A store waits for the editor's work to be ready before it writes: open
 * edits committed by a view's before-action handlers, tracked writes settled.
 * The editor can move to another document or language meanwhile, and then the
 * form holds that one's values: the store, bound to where it started, writes
 * nothing. A store that stops before its write says so itself.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@admin/components/ui", () => ({ toast }));

import type {
  DocumentActionOutcome,
  StoreReadiness,
} from "../useDocumentActionBindings";
import { useStoringGate } from "../useStoringGate";

beforeEach(() => {
  vi.clearAllMocks();
});

const MOVED =
  "You moved to another language or document before this was saved; nothing was stored.";

/** A gate over one document and language, whose scope a test can move. */
function renderGate() {
  return renderHook(({ scope }: { scope: string }) => useStoringGate(scope), {
    initialProps: { scope: "authors:e1:en" },
  });
}

/** A before-action handler that commits when the test says. */
function slowHandler() {
  let commit: () => void = () => {};
  const handler = () =>
    new Promise<void>(resolve => {
      commit = resolve;
    });
  return { handler, commit: () => commit() };
}

describe("useStoringGate", () => {
  it("stores nothing once the editor moved to another language while the store readied", async () => {
    const { result, rerender } = renderGate();
    const slow = slowHandler();
    act(() => {
      result.current.registerBeforeAction(slow.handler);
    });
    const perform = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({ ok: true })
    );

    let storing: Promise<DocumentActionOutcome> | undefined;
    act(() => {
      storing = result.current.storing("save", perform)();
    });
    // A switch to a language already cached: the form now holds its values.
    rerender({ scope: "authors:e1:de" });
    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      slow.commit();
      outcome = await storing;
    });

    expect(perform).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      reason: "refused",
      message: MOVED,
      beforeWrite: true,
      reported: true,
    });
    // The Save state answers for the language on screen, so the gate says
    // it once itself.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MOVED, expect.anything());
  });

  it("stores nothing once the editor went to another language and back while the store readied", async () => {
    const { result, rerender } = renderGate();
    const slow = slowHandler();
    act(() => {
      result.current.registerBeforeAction(slow.handler);
    });
    const perform = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({ ok: true })
    );

    let storing: Promise<DocumentActionOutcome> | undefined;
    act(() => {
      storing = result.current.storing("save", perform)();
    });
    // Away and back: the same language, but the form started afresh from
    // its cached values meanwhile.
    rerender({ scope: "authors:e1:de" });
    rerender({ scope: "authors:e1:en" });
    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      slow.commit();
      outcome = await storing;
    });

    expect(perform).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, message: MOVED });
  });

  it("says once itself why a store that settled after a move stopped", async () => {
    const { result, rerender } = renderGate();
    let refuse: (outcome: DocumentActionOutcome) => void = () => {};
    let writing = false;
    const perform = () =>
      new Promise<DocumentActionOutcome>(resolve => {
        writing = true;
        refuse = resolve;
      });

    let storing: Promise<DocumentActionOutcome> | undefined;
    act(() => {
      storing = result.current.storing("save", perform)();
    });
    // The write is under way when the editor moves.
    await vi.waitFor(() => expect(writing).toBe(true));
    rerender({ scope: "authors:e1:de" });
    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      refuse({ ok: false, reason: "refused", message: "Not this time." });
      outcome = await storing;
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Not this time.",
      expect.anything()
    );
    expect(outcome).toMatchObject({ reported: true });
  });

  it("stores where the editor stayed on its document and language", async () => {
    const { result } = renderGate();
    const slow = slowHandler();
    act(() => {
      result.current.registerBeforeAction(slow.handler);
    });
    const perform = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({ ok: true })
    );

    let storing: Promise<DocumentActionOutcome> | undefined;
    act(() => {
      storing = result.current.storing("save", perform)();
    });
    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      slow.commit();
      outcome = await storing;
    });

    expect(perform).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true });
  });

  it("marks a store a view's open edit stopped before its write", async () => {
    const { result } = renderGate();
    act(() => {
      result.current.registerBeforeAction(async () => {
        throw new Error("The block couldn't be committed.");
      });
    });
    const perform = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({ ok: true })
    );

    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      outcome = await result.current.storing("save", perform)();
    });

    expect(perform).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      reason: "failed",
      message: "The block couldn't be committed.",
      beforeWrite: true,
    });
  });

  /**
   * A handler that judges `work` and checks it before the write, and one
   * after it that changes the work `changes` times, as an author's edit
   * during a later handler's wait would.
   */
  function judgedThenChanged(changes: number) {
    let work = 0;
    let judged = 0;
    const judge = vi.fn((_action: string, store: StoreReadiness) => {
      const seen = work;
      judged += 1;
      store.checkBeforeWrite(() => work === seen);
    });
    const change = () => {
      if (judged <= changes) work += 1;
    };
    return { judge, change };
  }

  it("runs every handler again when a check before the write finds the work changed", async () => {
    const { result } = renderGate();
    const { judge, change } = judgedThenChanged(1);
    act(() => {
      result.current.registerBeforeAction(judge);
      result.current.registerBeforeAction(change);
    });
    const perform = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({ ok: true })
    );

    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      outcome = await result.current.storing("publish", perform)();
    });

    expect(judge).toHaveBeenCalledTimes(2);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true });
  });

  it("refuses a store whose work keeps changing before its write", async () => {
    const { result } = renderGate();
    const { judge, change } = judgedThenChanged(Number.POSITIVE_INFINITY);
    act(() => {
      result.current.registerBeforeAction(judge);
      result.current.registerBeforeAction(change);
    });
    const perform = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({ ok: true })
    );

    let outcome: DocumentActionOutcome | undefined;
    await act(async () => {
      outcome = await result.current.storing("publish", perform)();
    });

    expect(perform).not.toHaveBeenCalled();
    expect(judge).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ ok: false, reason: "busy" });
  });
});
