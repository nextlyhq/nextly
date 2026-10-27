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
 * arrives, and every other edit stays. From the action until that document
 * has arrived the form is held read-only, so nothing typed can race it.
 *
 * @module components/features/entries/EntryForm/useRefusedForm
 */
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

import { submitBusy, submitHeld, submitInvalid } from "./submit-outcome";

/** What the form says when its own checks refuse it, as a save does. */
const INVALID = submitInvalid.ok ? "" : submitInvalid.message;
/** What a save says while the document's writes are held, as a save does. */
const HELD = submitHeld.ok ? "" : submitHeld.message;
/** What a save says while another is in flight, as a save does. */
const BUSY = submitBusy.ok ? "" : submitBusy.message;

/**
 * Answers once what is already on its way to the editor has reached it, a
 * task later. React renders an action's state change, and a store change, at
 * once, running its effects as it commits; and React Query tells a query's
 * observers of new data on a zero-delay timeout, queued when the refetch
 * settled. A timeout queued after either runs after it.
 */
function nextTask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

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
    /**
     * The editor's own-save marker. The recovery's write is this editor's
     * own, so the document it brings back keeps whatever reached the form
     * meanwhile without passing a read-only field, such as a field that
     * commits on exit; even one that now carries the first working draft.
     */
    ownSave: RefObject<{ inFlight: boolean }>;
  }
): {
  refusedForm: RefusedForm;
  /**
   * Called with each document's values as they arrive, after the editor's own
   * reset: sets the fields taken, if any are waiting, to those values.
   */
  adoptArrived: (arrived: Record<string, unknown>) => void;
  /**
   * Whether a recovery is running, from the action through to its reloaded
   * document: the editor's fields are read-only meanwhile.
   */
  recovering: boolean;
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
  // Edits made while a recovery runs would race it: the save reads the form
  // once, and the fields taken are set over whatever was typed into them
  // since. So the form is held, as a document someone else holds is.
  const [recovering, setRecovering] = useState(false);

  const refusedForm = useMemo<RefusedForm>(
    () => ({
      pendingChangeNow: () =>
        new Promise((resolve, reject) => {
          form
            .handleSubmit(
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
            )()
            // The submit itself can reject, a resolver that throws, and then
            // neither callback runs: the recovery has to settle all the same,
            // or it holds the editor's latch for good.
            .catch(reject);
        }),
      adoptTaken: fields => {
        if (fields.length > 0) awaiting.current = fields;
      },
      run: async work => {
        // The same gate the editor's own saves pass: the recovery saves and
        // takes into the pending change, which is a write like any other.
        const { writesHeld, latch, ownSave } = gateNow.current;
        if (writesHeld()) throw new Error(HELD);
        if (latch.current) throw new Error(BUSY);
        latch.current = true;
        ownSave.current.inFlight = true;
        setRecovering(true);
        try {
          // The hold on screen before the recovery reads the form: a field
          // that commits as it goes read-only, such as an editor that commits
          // on leaving, has its work in what the recovery saves.
          await nextTask();
          const done = await work();
          // The reload it awaited has settled, but the editor is handed the
          // reloaded document a task later: the form stays held until then,
          // so nothing typed can meet the fields it takes.
          await nextTask();
          return done;
        } finally {
          // Cleared with the hold, once the reloaded document is on screen.
          ownSave.current.inFlight = false;
          latch.current = false;
          setRecovering(false);
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

  return { refusedForm, adoptArrived, recovering };
}

/**
 * The document's lock affordances while a recovery runs: its fields read-only,
 * as they are while someone else holds the document. The `readOnly` attribute
 * rather than `disabled`, so a field keeps focus and the author's place.
 */
export function heldWhileRecovering<T extends { readonly readOnly: boolean }>(
  lock: T,
  recovering: boolean
): T {
  return recovering ? { ...lock, readOnly: true } : lock;
}

/**
 * The autosave recovery while a recovery runs: nothing on offer, since
 * restoring a recovery point writes into the form the recovery holds.
 */
export function offerHeldWhileRecovering(
  recovery: UseAutosaveRecoveryResult,
  recovering: boolean
): UseAutosaveRecoveryResult {
  return recovering ? { ...recovery, offer: null } : recovery;
}
