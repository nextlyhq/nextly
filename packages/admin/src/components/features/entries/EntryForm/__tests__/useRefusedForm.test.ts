/**
 * The recovery's gate, on its own: a form whose own submit rejects, not just
 * one whose checks refuse, still settles the recovery and releases the
 * editor's latch, so the editor isn't left answering "busy" to every save.
 */
import { renderHook } from "@testing-library/react";
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
  it("rejects, and releases the latch, when the form's own submit rejects", async () => {
    const latch = { current: false };
    const ownSave = { current: { inFlight: false } };
    const { result } = renderHook(() =>
      useRefusedForm(formWhoseSubmitRejects(), values => values, {
        writesHeld: () => false,
        latch,
        ownSave,
      })
    );

    await expect(
      result.current.refusedForm.run(() =>
        result.current.refusedForm.pendingChangeNow()
      )
    ).rejects.toThrow("The resolver threw.");
    // A later save finds the editor free, not busy.
    expect(latch.current).toBe(false);
    expect(ownSave.current.inFlight).toBe(false);
  });
});
