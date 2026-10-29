/**
 * A store waits for the editor's work to be ready before it writes: open
 * edits committed by a view's before-action handlers, tracked writes settled.
 * The editor can move to another document or language meanwhile, and then the
 * form holds that one's values: the store, bound to where it started, writes
 * nothing. A store that stops before its write says so itself.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DocumentActionOutcome } from "../useDocumentActionBindings";
import { useStoringGate } from "../useStoringGate";

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
    });
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
});
