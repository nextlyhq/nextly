/**
 * A document form, as the way out of a publish refused over out-of-date
 * shared fields reaches it: the part the entry and Single editors share.
 *
 * The way out saves the form as the pending change with the editor's own
 * Save, then takes the live values into that change. From the action until
 * the reloaded document is on screen the form is held read-only, so nothing
 * typed can race either write; then it starts afresh from that document, as
 * when it first loads. Everything it held is in the change its Save stored,
 * and the fields taken now carry the live values.
 *
 * @module components/features/entries/EntryForm/useRefusedForm
 */
import { type RefObject, useMemo, useRef, useState } from "react";

import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

import { submitBusy, submitHeld } from "./submit-outcome";
import type { DocumentActionOutcome } from "./useDocumentActionBindings";

/** What a save says while the document's writes are held, as a save does. */
const HELD = submitHeld.ok ? "" : submitHeld.message;
/** What a save says while another is in flight, as a save does. */
const BUSY = submitBusy.ok ? "" : submitBusy.message;

/** Why the recovery stopped at its save, with what that save came to. */
export class RecoverySaveRefused extends Error {
  constructor(readonly outcome: Exclude<DocumentActionOutcome, { ok: true }>) {
    super(outcome.message);
  }
}

/** What the recovery's save comes to where no save of the document stays unpublished. */
const NO_SAVE_WITHOUT_PUBLISHING: Exclude<DocumentActionOutcome, { ok: true }> =
  {
    ok: false,
    reason: "refused",
    message:
      "This document can't be saved without publishing, so the live values can't be taken into it.",
  };

/**
 * Answers once what is already on its way to the editor has reached it, a
 * task later. React renders a store change at once, running its effects as
 * it commits, and React Query tells a query's observers of new data on a
 * zero-delay timeout, queued when the refetch settled. A timeout queued after
 * it runs after both.
 */
function nextTask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

export function useRefusedForm(gate: {
  /**
   * Whether the editor's writes are held now: the document is someone else's,
   * or a past version is on screen. The editor's Save asks it immediately
   * before its write, and the recovery immediately before its own.
   */
  writesHeld: () => boolean;
  /**
   * The editor's submission latch, set while one of its writes is in flight.
   * The recovery takes it once its Save is done, so the two never overlap.
   */
  latch: RefObject<boolean>;
  /**
   * The editor's Save of the pending change, exactly as its Save control runs
   * it — open edits committed, tracked writes settled, its own checks — but
   * never one that publishes. Unset where every save of this document would.
   */
  saveWithoutPublishing: RefObject<
    (() => Promise<DocumentActionOutcome>) | undefined
  >;
  /**
   * Start the form afresh from the document on screen, as when it first
   * loads. Called once the recovery's reloaded document is there.
   */
  resetToDocument: () => void;
}): {
  refusedForm: RefusedForm;
  /**
   * Whether a recovery is running, from the action through to its reloaded
   * document: the editor's fields are read-only meanwhile.
   */
  recovering: boolean;
} {
  // Read when the recovery runs, so it follows the render it runs after.
  const gateNow = useRef(gate);
  gateNow.current = gate;
  // Edits made while a recovery runs would race it: its Save reads the form
  // once, and the fields taken are set over whatever was typed since. So the
  // form is held, as a document someone else holds is.
  const [recovering, setRecovering] = useState(false);

  const refusedForm = useMemo<RefusedForm>(
    () => ({
      mayWrite: () => !gateNow.current.writesHeld(),
      recover: async take => {
        // The same gate the editor's own saves pass.
        const { writesHeld, latch } = gateNow.current;
        if (writesHeld()) throw new Error(HELD);
        if (latch.current) throw new Error(BUSY);
        // Held from the action, through the Save, until the form starts
        // afresh: no moment between the two writes when a field is open.
        setRecovering(true);
        let holdsLatch = false;
        try {
          const save = gateNow.current.saveWithoutPublishing.current;
          const saved = save ? await save() : NO_SAVE_WITHOUT_PUBLISHING;
          if (!saved.ok) throw new RecoverySaveRefused(saved);
          // The Save has let the latch go; taken here, with nothing awaited
          // in between, for the take and the reload.
          if (latch.current) throw new Error(BUSY);
          latch.current = true;
          holdsLatch = true;
          await take();
          // The reload the take awaited has settled, but the editor is handed
          // the reloaded document a task later: the form stays held until
          // then, and then starts afresh from it.
          await nextTask();
          gateNow.current.resetToDocument();
        } finally {
          if (holdsLatch) latch.current = false;
          setRecovering(false);
        }
      },
    }),
    []
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
