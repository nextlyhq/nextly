/**
 * The recovery's gate, on its own: a form whose own submit rejects, not just
 * one whose checks refuse, still settles the recovery and releases the
 * editor's latch, so the editor isn't left answering "busy" to every save.
 */
import { act, renderHook } from "@testing-library/react";
import type { UseFormReturn } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { useRefusedForm } from "../useRefusedForm";

/** A form whose submit rejects outright, as a resolver that throws makes it. */
function formWhoseSubmitRejects(): UseFormReturn<Record<string, unknown>> {
  return {
    handleSubmit: () => () => Promise.reject(new Error("The resolver threw.")),
    setValue: () => {},
  } as unknown as UseFormReturn<Record<string, unknown>>;
}

describe("useRefusedForm", () => {
  it("rejects, and releases the hold, when the form's own submit rejects", async () => {
    const latch = { current: false };
    const ownSave = { current: { inFlight: false } };
    const { result } = renderHook(() =>
      useRefusedForm(formWhoseSubmitRejects(), values => values, {
        writesHeld: () => false,
        latch,
        ownSave,
      })
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
    // Held while it runs: the form, the editor's latch and its own-save mark.
    expect(result.current.recovering).toBe(true);
    expect(latch.current).toBe(true);
    expect(ownSave.current.inFlight).toBe(true);

    let settled: unknown;
    await act(async () => {
      settled = await outcome;
    });
    expect(settled).toEqual(new Error("The resolver threw."));
    // And released, so a later save finds the editor free, not busy.
    expect(result.current.recovering).toBe(false);
    expect(latch.current).toBe(false);
    expect(ownSave.current.inFlight).toBe(false);
  });
});
