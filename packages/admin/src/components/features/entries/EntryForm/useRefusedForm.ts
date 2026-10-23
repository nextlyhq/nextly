/**
 * A document form, as the way out of a publish refused over out-of-date
 * shared fields reaches it: the part the entry and Single editors share.
 *
 * The refusal's action runs later than the refusal, and the author may keep
 * editing in between, so what it saves is read from the form when it runs,
 * through the form's own checks and the same payload a save of the pending
 * change sends. Once the live values are taken into the change, the reloaded
 * document has the same identity as the one on screen, so neither editor
 * resets to it in full: the fields taken are set to it here, when it
 * arrives, and every other edit stays.
 *
 * @module components/features/entries/EntryForm/useRefusedForm
 */
import { type RefObject, useCallback, useMemo, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

import { submitBusy, submitHeld, submitInvalid } from "./submit-outcome";

/** What the form says when its own checks refuse it, as a save does. */
const INVALID = submitInvalid.ok ? "" : submitInvalid.message;
/** What a save says while the document's writes are held, as a save does. */
const HELD = submitHeld.ok ? "" : submitHeld.message;
/** What a save says while another is in flight, as a save does. */
const BUSY = submitBusy.ok ? "" : submitBusy.message;

export function useRefusedForm(
  form: UseFormReturn<Record<string, unknown>>,
  /** The payload a validated form becomes for a save of the pending change. */
  toPendingChange: (values: Record<string, unknown>) => Record<string, unknown>,
  gate: {
    /**
     * Whether the editor's writes are held now: the document is someone
     * else's, or a past version is on screen. Asked when the recovery runs.
     */
    writesHeld: () => boolean;
    /**
     * The editor's submission latch, set while one of its writes is in
     * flight. The recovery takes it too, so the two never overlap.
     */
    latch: RefObject<boolean>;
  }
): {
  refusedForm: RefusedForm;
  /**
   * Called with each document's values as they arrive, after the editor's own
   * reset: sets the fields taken, if any are waiting, to those values.
   */
  adoptArrived: (arrived: Record<string, unknown>) => void;
} {
  // Read when the action runs, so the payload follows the fields of the
  // render it runs after.
  const toPayload = useRef(toPendingChange);
  toPayload.current = toPendingChange;
  // Read when the recovery runs, for the same reason.
  const gateNow = useRef(gate);
  gateNow.current = gate;
  // The fields taken, until the document that carries them arrives.
  const awaiting = useRef<readonly string[] | null>(null);

  const refusedForm = useMemo<RefusedForm>(
    () => ({
      pendingChangeNow: () =>
        new Promise((resolve, reject) => {
          void form.handleSubmit(
            values => {
              try {
                resolve(toPayload.current(values));
              } catch (error) {
                reject(
                  error instanceof Error ? error : new Error(String(error))
                );
              }
            },
            () => {
              reject(new Error(INVALID));
            }
          )();
        }),
      adoptTaken: fields => {
        if (fields.length > 0) awaiting.current = fields;
      },
      run: async work => {
        // The same gate the editor's own saves pass: the recovery saves and
        // takes into the pending change, which is a write like any other.
        const { writesHeld, latch } = gateNow.current;
        if (writesHeld()) throw new Error(HELD);
        if (latch.current) throw new Error(BUSY);
        latch.current = true;
        try {
          return await work();
        } finally {
          latch.current = false;
        }
      },
    }),
    [form]
  );

  const adoptArrived = useCallback(
    (arrived: Record<string, unknown>) => {
      const fields = awaiting.current;
      if (!fields) return;
      awaiting.current = null;
      for (const name of fields) {
        // A field the form doesn't hold, one the editor can't see, has
        // nothing on screen to bring up to date. `setValue` rather than
        // `resetField`, which skips a field with no input mounted, such as
        // one on a tab never opened; marking it dirty against the arrived
        // values clears it as unsaved once the two agree.
        if (name in arrived) {
          form.setValue(name, arrived[name], { shouldDirty: true });
        }
      }
    },
    [form]
  );

  return { refusedForm, adoptArrived };
}
