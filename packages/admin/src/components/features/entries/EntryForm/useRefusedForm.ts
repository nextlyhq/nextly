/**
 * A document form, as the way out of a publish refused over out-of-date
 * shared fields reaches it: the part the entry and Single editors share.
 *
 * The refusal's action runs later than the refusal, and the author may keep
 * editing in between, so what it saves is read from the form when it runs,
 * through the form's own checks and the same payload a save of the pending
 * change sends. From the action until the reloaded document is on screen
 * the form is held read-only, so nothing typed can race it; then it starts
 * afresh from that document, as when it first loads. Everything it held is in
 * the pending change it saved, and the fields taken now carry the live values.
 *
 * @module components/features/entries/EntryForm/useRefusedForm
 */
import { type RefObject, useMemo, useRef, useState } from "react";
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
     * Start the form afresh from the document on screen, as when it first
     * loads. Called once the recovery's reloaded document is there.
     */
    resetToDocument: () => void;
    /**
     * Count the recovery's save as one of the editor's own: an autosave
     * recovery point is gone with it, as it is after any save.
     */
    saved: () => void;
  }
): {
  refusedForm: RefusedForm;
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
      saved: () => {
        gateNow.current.saved();
      },
      run: async work => {
        // The same gate the editor's own saves pass: the recovery saves and
        // takes into the pending change, which is a write like any other.
        const { writesHeld, latch } = gateNow.current;
        if (writesHeld()) throw new Error(HELD);
        if (latch.current) throw new Error(BUSY);
        latch.current = true;
        setRecovering(true);
        try {
          // The hold on screen before the recovery reads the form: a field
          // that commits as it goes read-only, such as an editor that commits
          // on leaving, has its work in what the recovery saves.
          await nextTask();
          const done = await work();
          // The reload it awaited has settled, but the editor is handed the
          // reloaded document a task later: the form stays held until then,
          // and then starts afresh from it.
          await nextTask();
          gateNow.current.resetToDocument();
          return done;
        } finally {
          latch.current = false;
          setRecovering(false);
        }
      },
    }),
    [form]
  );

  return { refusedForm, recovering };
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
