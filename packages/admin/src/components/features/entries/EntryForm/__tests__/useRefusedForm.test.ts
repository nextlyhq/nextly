/**
 * The recovery's gate, on its own: a form whose own submit rejects, not just
 * one whose checks refuse, still settles the recovery and releases the
 * editor's latch, so the editor isn't left answering "busy" to every save.
 */
import { act, renderHook } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { useRefusedForm } from "../useRefusedForm";

/** A form whose submit rejects outright, as a resolver that throws makes it. */
function formWhoseSubmitRejects(): UseFormReturn<Record<string, unknown>> {
  return {
    handleSubmit: () => () => Promise.reject(new Error("The resolver threw.")),
    setValue: () => {},
  } as unknown as UseFormReturn<Record<string, unknown>>;
}

describe("useRefusedForm", () => {
  /** The gate an editor hands the recovery, recording what it was asked. */
  function gate() {
    return {
      writesHeld: () => false,
      latch: { current: false },
      resetToDocument: vi.fn(),
      saved: vi.fn(),
    };
  }

  it("rejects, and releases the hold, when the form's own submit rejects", async () => {
    const editor = gate();
    const { result } = renderHook(() =>
      useRefusedForm(formWhoseSubmitRejects(), values => values, editor)
    );

    let outcome: Promise<unknown> | undefined;
    act(() => {
      outcome = result.current.refusedForm
        .run(() => result.current.refusedForm.pendingChangeNow())
        .then(
          () => "resolved",
          (error: unknown) => error
        );
    });
    // Held while it runs: the form and the editor's latch.
    expect(result.current.recovering).toBe(true);
    expect(editor.latch.current).toBe(true);

    let settled: unknown;
    await act(async () => {
      settled = await outcome;
    });
    expect(settled).toEqual(new Error("The resolver threw."));
    // And released, so a later save finds the editor free, not busy. The
    // form keeps what it holds: nothing was saved or taken.
    expect(result.current.recovering).toBe(false);
    expect(editor.latch.current).toBe(false);
    expect(editor.resetToDocument).not.toHaveBeenCalled();
  });

  it("starts the form afresh from the document on screen once the recovery has run, then releases it", async () => {
    const editor = gate();
    const { result } = renderHook(() =>
      useRefusedForm(formWhoseSubmitRejects(), values => values, editor)
    );
    let heldAtReset: boolean | undefined;
    editor.resetToDocument.mockImplementation(() => {
      heldAtReset = editor.latch.current;
    });

    await act(async () => {
      await result.current.refusedForm.run(async () => "done");
    });

    expect(editor.resetToDocument).toHaveBeenCalledTimes(1);
    // Reset while still held, so nothing can be typed between the two.
    expect(heldAtReset).toBe(true);
    expect(editor.latch.current).toBe(false);
    expect(result.current.recovering).toBe(false);
  });

  it("hands the editor word of the recovery's save", () => {
    const editor = gate();
    const { result } = renderHook(() =>
      useRefusedForm(formWhoseSubmitRejects(), values => values, editor)
    );

    result.current.refusedForm.saved();

    expect(editor.saved).toHaveBeenCalledTimes(1);
  });
});
