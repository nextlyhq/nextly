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
import { notifyManager } from "@tanstack/react-query";
import {
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { toast } from "@admin/components/ui";
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

/** What the recovery's save comes to in the quick-edit modal. */
const NO_SAVE_IN_QUICK_EDIT: Exclude<DocumentActionOutcome, { ok: true }> = {
  ok: false,
  reason: "refused",
  message:
    "Open the document to take the live values: they can't be taken from this quick edit.",
};

/**
 * The Save a recovery in the quick-edit modal is given. The modal has no
 * document actions, so no Save of its own to store the form with, and a
 * write of the recovery's own would skip what that Save runs: so it refuses,
 * writing nothing, and points to the document, whose editor has one.
 */
export const quickEditSave: RefObject<() => Promise<DocumentActionOutcome>> = {
  current: () => Promise.resolve(NO_SAVE_IN_QUICK_EDIT),
};

/**
 * Answers once what is already on its way to the editor has reached it.
 * React Query tells a query's observers of new data through its scheduler,
 * queued when the refetch settled, and React renders that change at once,
 * running its effects as it commits. Scheduled after it, on the same
 * scheduler rather than a timeout of its own, this runs after both, however
 * the host has React Query schedule (by default, a zero-delay timeout).
 */
function afterQueryNotifications(): Promise<void> {
  return new Promise(resolve => {
    notifyManager.schedule(resolve);
  });
}

/**
 * The documents, each in one language, a refused publish's recovery holds,
 * from its action until it lets go, whichever editor shows them and whatever
 * that editor shows meanwhile. Counted, so two editors of one document each
 * let go of their own hold only.
 */
const heldScopes = new Map<string, number>();
const holdListeners = new Set<() => void>();

function changeHold(scope: string, by: 1 | -1): void {
  const count = (heldScopes.get(scope) ?? 0) + by;
  if (count > 0) heldScopes.set(scope, count);
  else heldScopes.delete(scope);
  for (const listener of holdListeners) listener();
}

function subscribeToHolds(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => {
    holdListeners.delete(listener);
  };
}

export function useRefusedForm(gate: {
  /**
   * The document and language on screen. A recovery holds the one it was
   * refused for, binds its Save to it, and starts the form afresh only where
   * it is on screen.
   */
  scope: string;
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
  // document it is for is held, as one someone else holds is, wherever and
  // whenever it is on screen until the recovery lets go; another document or
  // language the editor moves to meanwhile is not.
  const scopeShown = gate.scope;
  const recovering = useSyncExternalStore(
    subscribeToHolds,
    () => heldScopes.has(scopeShown),
    () => false
  );
  // Set the moment a recovery enters, before anything is awaited, and let go
  // with its hold. The editor's latch is free while the recovery's Save waits
  // on a view's work, so a second recovery is refused here instead, before
  // it can touch a hold only the recovery that set it lets go.
  const running = useRef(false);
  // The document the recovery holds the editor's latch for, through the take
  // and the reload: let go when the editor shows another, whose writes this
  // recovery doesn't hold.
  const latchHeldFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (latchHeldFor.current === null || latchHeldFor.current === scopeShown) {
      return;
    }
    gateNow.current.latch.current = false;
    latchHeldFor.current = null;
  }, [scopeShown]);

  const refusedForm = useMemo<RefusedForm>(
    () => ({
      mayWrite: () => !gateNow.current.writesHeld(),
      recover: async take => {
        // The same gate the editor's own saves pass.
        const { writesHeld, latch } = gateNow.current;
        if (writesHeld()) throw new Error(HELD);
        if (latch.current || running.current) throw new Error(BUSY);
        const refused = gateNow.current.scope;
        let holds = false;
        try {
          // Taken and let go in this one try, so nothing can leave it set.
          running.current = true;
          // Held from the action, through the Save, until the form starts
          // afresh: no moment between the two writes when a field is open.
          changeHold(refused, 1);
          holds = true;
          const save = gateNow.current.saveWithoutPublishing.current;
          const saved = save ? await save() : NO_SAVE_WITHOUT_PUBLISHING;
          if (!saved.ok) throw new RecoverySaveRefused(saved);
          // The Save has let the latch go; taken here, with nothing awaited
          // in between, for the take and the reload.
          if (latch.current) throw new Error(BUSY);
          latch.current = true;
          latchHeldFor.current = refused;
          await take();
          // The reload the take awaited has settled, but the editor is handed
          // the reloaded document once React Query notifies it: the form
          // stays held until then, and then starts afresh from it, where it
          // still shows that document.
          await afterQueryNotifications();
          if (gateNow.current.scope === refused) {
            gateNow.current.resetToDocument();
          }
        } finally {
          if (latchHeldFor.current === refused) {
            latch.current = false;
            latchHeldFor.current = null;
          }
          running.current = false;
          if (holds) changeHold(refused, -1);
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
 * The editor's switch to another language while a recovery holds the one on
 * screen: refused, as the fields are, so its Save and take stay on the
 * language they are for. One gate at the handler, so every control that
 * switches, a field's own included, is held.
 */
export function heldLocaleChange<A extends unknown[]>(
  change: ((...args: A) => void) | undefined,
  recovering: boolean
): ((...args: A) => void) | undefined {
  if (!change || !recovering) return change;
  return () => {
    toast.warning(
      "The live values are still being taken. Switch languages once they're in."
    );
  };
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
