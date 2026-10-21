/**
 * One submission of a document form, from validation to what the form starts
 * from afterwards: the part the entry and Single editors share.
 *
 * Each editor decides who may submit and how a document is written; what
 * happens around the write is the same question for both, so it is answered
 * once here — validated or refused, written or failed, and the form left
 * holding what the server stored without losing what was typed meanwhile.
 *
 * @module components/features/entries/EntryForm/submit-document
 */
import type { BaseSyntheticEvent } from "react";
import type { UseFormReturn } from "react-hook-form";

import { adoptStoredValues } from "./adopt-stored";
import {
  submitFailed,
  submitInvalid,
  type SubmitOutcome,
} from "./submit-outcome";

/** What one write came to, for the form to start from. */
export interface DocumentWrite {
  /** The saved document, for the caller. */
  item: { id: string };
  /**
   * The stored values in the form's shape, or null where the write reports
   * none — then what was sent is the best starting point there is.
   */
  stored: Record<string, unknown> | null;
}

export async function submitDocument(args: {
  form: UseFormReturn<Record<string, unknown>>;
  event?: BaseSyntheticEvent;
  /** The payload a validated form becomes, for this save's intent. */
  toPayload: (values: Record<string, unknown>) => Record<string, unknown>;
  /** Writes the payload. A rejection is the save failing. */
  write: (payload: Record<string, unknown>) => Promise<DocumentWrite>;
  /** Hears a failed write, after it is logged. */
  onFailure?: (error: unknown) => void;
}): Promise<SubmitOutcome> {
  const { form, toPayload, write, onFailure } = args;
  // The values this save is made from, as the form held them, before
  // validation's transforms: what is compared afterwards to find what the
  // author typed while the save was in flight.
  const submitted = structuredClone(form.getValues());
  // Validation decides which callback runs, and only one does; the default
  // covers neither running, which RHF does not do today.
  let outcome: SubmitOutcome = submitInvalid;
  await form.handleSubmit(
    async validated => {
      const payload = toPayload(validated);
      try {
        const written = await write(payload);
        if (written.stored === null) form.reset(payload);
        // What the server stored becomes the form's starting point, keeping
        // anything typed while the save was in flight.
        else adoptStoredValues(form, written.stored, submitted);
        outcome = { ok: true, item: written.item };
      } catch (error) {
        console.error("Form submission error:", error);
        onFailure?.(error);
        outcome = submitFailed(error);
      }
    },
    () => {
      outcome = submitInvalid;
    }
  )(args.event);
  return outcome;
}
