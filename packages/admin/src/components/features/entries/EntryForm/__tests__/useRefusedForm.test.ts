/**
 * The recovery's gate and hold, on their own: the form is held from the call,
 * through the editor's own Save, until it starts afresh; the take runs only
 * once that Save has stored, under the editor's latch; and the form is let go
 * however the recovery ends.
 */
import { defaultScheduler, notifyManager } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DocumentActionOutcome } from "../useDocumentActionBindings";
import { RecoverySaveRefused, useRefusedForm } from "../useRefusedForm";

/** The gate an editor hands the recovery, recording what it was asked. */
function gate(save?: () => Promise<DocumentActionOutcome>) {
  return {
    writesHeld: vi.fn(() => false),
    latch: { current: false },
    saveWithoutPublishing: { current: save },
    resetToDocument: vi.fn(),
  };
}

/** A promise and the means to settle it, made before it is awaited. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useRefusedForm", () => {
  it("holds the form from the call, runs the take only once the Save has stored, then starts the form afresh and lets it go", async () => {
    const saving = deferred<DocumentActionOutcome>();
    const editor = gate(() => saving.promise);
    const { result } = renderHook(() => useRefusedForm(editor));
    const seen: { during: string; held: boolean; latched: boolean }[] = [];
    const take = vi.fn(async () => {
      seen.push({
        during: "take",
        held: result.current.recovering,
        latched: editor.latch.current,
      });
    });

    let running: Promise<void> | undefined;
    act(() => {
      running = result.current.refusedForm.recover(take);
    });
    // Held from the call, while the Save runs, and the Save has the latch to
    // itself: nothing is taken yet.
    expect(result.current.recovering).toBe(true);
    expect(editor.latch.current).toBe(false);
    expect(take).not.toHaveBeenCalled();

    await act(async () => {
      saving.resolve({ ok: true });
      await running;
    });

    // Still held when the take ran, now under the latch; then started afresh
    // and let go.
    expect(seen).toEqual([{ during: "take", held: true, latched: true }]);
    expect(editor.resetToDocument).toHaveBeenCalledTimes(1);
    expect(result.current.recovering).toBe(false);
    expect(editor.latch.current).toBe(false);
  });

  it("starts the form afresh only once React Query has told the editor of the reloaded document, on whatever scheduler it uses", async () => {
    // A host can schedule React Query's notifications its own way, such as on
    // the next animation frame: until they run, the editor still shows the
    // document from before the take.
    const scheduled: (() => void)[] = [];
    notifyManager.setScheduler(callback => {
      scheduled.push(callback);
    });
    try {
      const editor = gate(async () => ({ ok: true }));
      const { result } = renderHook(() => useRefusedForm(editor));
      let running: Promise<void> | undefined;
      await act(async () => {
        running = result.current.refusedForm.recover(async () => undefined);
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      expect(editor.resetToDocument).not.toHaveBeenCalled();
      expect(result.current.recovering).toBe(true);

      await act(async () => {
        for (const notify of scheduled.splice(0)) notify();
        await running;
      });
      expect(editor.resetToDocument).toHaveBeenCalledTimes(1);
      expect(result.current.recovering).toBe(false);
    } finally {
      notifyManager.setScheduler(defaultScheduler);
    }
  });

  it("refuses a second recovery while the first awaits its Save, and leaves the first's hold alone", async () => {
    // The Save waits, as it does on a view's before-action handler or a
    // tracked write, before the editor's own latch is taken.
    const saving = deferred<DocumentActionOutcome>();
    const taking = deferred<void>();
    const editor = gate(() => saving.promise);
    const { result } = renderHook(() => useRefusedForm(editor));
    let takeStarted = false;
    const firstTake = vi.fn(async () => {
      takeStarted = true;
      await taking.promise;
    });
    const secondTake = vi.fn(async () => undefined);

    let first: Promise<void> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = result.current.refusedForm.recover(firstTake);
      second = result.current.refusedForm
        .recover(secondTake)
        .catch((error: unknown) => error);
    });
    await act(async () => {
      saving.resolve({ ok: true });
      await second;
    });
    await vi.waitFor(() => expect(takeStarted).toBe(true));

    // Refused as a save in flight is; the first still holds the form while
    // it takes, so nothing typed can reach it.
    expect(await second).toBeInstanceOf(Error);
    expect(result.current.recovering).toBe(true);

    await act(async () => {
      taking.resolve();
      await first;
    });
    expect(secondTake).not.toHaveBeenCalled();
    expect(editor.resetToDocument).toHaveBeenCalledTimes(1);
    expect(result.current.recovering).toBe(false);
  });

  it("runs a later recovery once an earlier one's Save was refused", async () => {
    const refused: DocumentActionOutcome = {
      ok: false,
      reason: "failed",
      message: "The entry couldn't be saved.",
    };
    const save = vi
      .fn<() => Promise<DocumentActionOutcome>>()
      .mockResolvedValueOnce(refused)
      .mockResolvedValue({ ok: true });
    const editor = gate(save);
    const { result } = renderHook(() => useRefusedForm(editor));
    const take = vi.fn(async () => undefined);

    await act(async () => {
      await result.current.refusedForm.recover(take).catch(() => undefined);
    });
    await act(async () => {
      await result.current.refusedForm.recover(take);
    });

    expect(take).toHaveBeenCalledTimes(1);
    expect(editor.resetToDocument).toHaveBeenCalledTimes(1);
    expect(result.current.recovering).toBe(false);
  });

  it("takes nothing, and lets the form go untouched, when the Save didn't store", async () => {
    const refused: DocumentActionOutcome = {
      ok: false,
      reason: "failed",
      message: "The entry couldn't be saved.",
    };
    const editor = gate(async () => refused);
    const { result } = renderHook(() => useRefusedForm(editor));
    const take = vi.fn(async () => undefined);

    let failure: unknown;
    await act(async () => {
      failure = await result.current.refusedForm
        .recover(take)
        .catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(RecoverySaveRefused);
    expect((failure as RecoverySaveRefused).outcome).toEqual(refused);
    expect(take).not.toHaveBeenCalled();
    expect(editor.resetToDocument).not.toHaveBeenCalled();
    expect(result.current.recovering).toBe(false);
    expect(editor.latch.current).toBe(false);
  });

  it("takes nothing where no Save of the document stays unpublished", async () => {
    const editor = gate(undefined);
    const { result } = renderHook(() => useRefusedForm(editor));
    const take = vi.fn(async () => undefined);

    let failure: unknown;
    await act(async () => {
      failure = await result.current.refusedForm
        .recover(take)
        .catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(RecoverySaveRefused);
    expect(take).not.toHaveBeenCalled();
    expect(result.current.recovering).toBe(false);
  });

  it("lets the form go when the take fails, without starting it afresh", async () => {
    const editor = gate(async () => ({ ok: true }));
    const { result } = renderHook(() => useRefusedForm(editor));

    let failure: unknown;
    await act(async () => {
      failure = await result.current.refusedForm
        .recover(() => Promise.reject(new Error("offline")))
        .catch((error: unknown) => error);
    });

    expect(failure).toEqual(new Error("offline"));
    expect(editor.resetToDocument).not.toHaveBeenCalled();
    expect(result.current.recovering).toBe(false);
    expect(editor.latch.current).toBe(false);
  });

  it("is refused, saving nothing, while the editor's writes are held or a save is in flight", async () => {
    const save = vi.fn(
      async (): Promise<DocumentActionOutcome> => ({
        ok: true,
      })
    );
    const held = gate(save);
    held.writesHeld.mockReturnValue(true);
    const busy = gate(save);
    busy.latch.current = true;

    for (const editor of [held, busy]) {
      const { result } = renderHook(() => useRefusedForm(editor));
      await expect(
        result.current.refusedForm.recover(async () => undefined)
      ).rejects.toThrow();
      expect(result.current.recovering).toBe(false);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("answers whether the editor may write now from the editor's own hold", () => {
    const editor = gate(undefined);
    const { result } = renderHook(() => useRefusedForm(editor));

    expect(result.current.refusedForm.mayWrite()).toBe(true);
    editor.writesHeld.mockReturnValue(true);
    expect(result.current.refusedForm.mayWrite()).toBe(false);
  });
});
