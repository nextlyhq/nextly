/**
 * Which document actions this editor offers right now, what each one runs,
 * and running one with a true answer.
 *
 * The header used to decide this inline, beside the controls it draws. A
 * plugin's document view replaces the form body without the header, and a
 * keyboard shortcut runs a save with no control at all, so the decision lives
 * here, called once by the editor that hosts the form, and every surface that
 * offers an action reads the same answer.
 *
 * The confirmations travel with it. Unpublish and discarding a working draft
 * are confirmed before they run, so their open state is part of what running
 * them means: an action started from somewhere other than the header still
 * has to ask first, and its outcome is what the answer led to.
 *
 * @module components/features/entries/EntryForm/useDocumentActionBindings
 */
import type { OverridableDocumentAction } from "nextly/config";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import type { RestoreOutcome } from "@admin/hooks/useAutosaveRecovery";
import { useCan } from "@admin/hooks/useCan";
import { useLocalization } from "@admin/hooks/useLocalization";

import {
  documentActions,
  reviewStepActionId,
  type EditorDocumentAction,
  type ReviewActionState,
} from "./document-actions";
import {
  acceptContributions,
  reasonFor,
  type ActionBinding,
  type ActionRecovery,
  type ContributedAction,
} from "./DocumentActionBar";
import { effectiveEntryStatus, everPublishedOnRecord } from "./entry-address";
import type {
  DeleteOutcome,
  SubmitOutcome,
  SubmitRefusal,
} from "./submit-outcome";
import { useLeaveWithoutWarning } from "./UnsavedChangesGuard";
import type { EntryData, EntryFormIntent, EntryFormMode } from "./useEntryForm";
import { useStoringGate, type StoringGate } from "./useStoringGate";

/** The actions this editor builds in, which a contribution may still take over. */
type BuiltInActionId =
  | "save"
  | "publish"
  | "duplicate"
  | "view-api"
  | "discard-draft"
  | "discard-changes"
  | "unpublish"
  | "delete";

/**
 * How the editor applies a plugin's override of one built-in action.
 *
 * `open` is what choosing a replaced action runs; it resolves with what the
 * replacement came to, so a caller that leaves the document once Delete is
 * done does not leave one the author backed out of deleting.
 */
export type DocumentActionOverride =
  | { kind: "hidden" }
  /**
   * Offered but not runnable: while the editor cannot yet tell whether a
   * plugin hides or replaces the action, its built-in write must not run in
   * the meantime. `reason` is told the action's own label, so what the row
   * says names the row; `retry`, where given, is offered beside it.
   */
  | {
      kind: "held";
      reason: (label: string) => string;
      retry?: ActionRecovery;
    }
  | {
      kind: "replaced";
      label?: string;
      open: () => Promise<DocumentActionOutcome>;
    };

/** The overrides for one collection's document, by built-in action. */
export type DocumentActionOverrides = Partial<
  Record<OverridableDocumentAction, DocumentActionOverride>
>;

/** A handler whose work is stored, and which says how that went. */
type StoringHandler = () => void | Promise<SubmitOutcome>;

/**
 * The storing handlers an editor's actions run: one per intent, every one
 * through the editor's single submit, so a host cannot wire one intent to a
 * different save from the rest.
 */
export function storingHandlers(
  submit: (
    event?: undefined,
    intent?: EntryFormIntent
  ) => Promise<SubmitOutcome>
): Pick<
  DocumentActionBindingsInput,
  | "onSubmit"
  | "onSaveDraft"
  | "onPublish"
  | "onSaveChanges"
  | "onSaveWorkingDraft"
  | "onUnpublish"
> {
  return {
    onSubmit: () => submit(),
    onSaveDraft: () => submit(undefined, "save-draft"),
    onPublish: () => submit(undefined, "publish"),
    onSaveChanges: () => submit(undefined, "save-changes"),
    onSaveWorkingDraft: () => submit(undefined, "save-working-draft"),
    onUnpublish: () => submit(undefined, "unpublish"),
  };
}

/**
 * The workflow's part of the header: where the part on screen stands, and how
 * a step is taken. Absent where no workflow is attached.
 */
export interface DocumentReviewBinding {
  state: ReviewActionState;
  /** Takes the named step, asking first where it needs a comment. */
  takeStep: (step: string) => Promise<DocumentActionOutcome>;
}

/** What deciding the actions reads. */
export interface DocumentActionBindingsInput {
  /** Form mode: what the save is called, and whether edit-only actions exist. */
  mode: EntryFormMode;
  /** Whether the collection has the Draft/Published feature enabled.
   *  Splits the primary submit into Save Draft + Publish/Update. */
  hasStatus: boolean;
  /** Whether the working-draft split is enabled (drafts on a versioned
   *  collection). When `true`, editing a PUBLISHED entry saves a pending
   *  working draft (live row untouched) instead of re-publishing, and a
   *  separate Publish promotes it. */
  draftsEnabled?: boolean;
  /** Whether the form is currently submitting. */
  isSubmitting?: boolean;
  /** Whether the form has validation errors. Withholds the save. */
  isInvalid?: boolean;
  /** Whether the form has unsaved changes. */
  isDirty?: boolean;
  /**
   * The form this editor's save submits.
   *
   * Load-bearing for a collection with NO status column: that save has always
   * been a native submit with no intent attached, because every intent-carrying
   * handler writes a `status` such a collection does not have.
   */
  formId?: string;
  /** The document, for its status, its working draft and its label. */
  entry?: EntryData | null;
  /** The collection or Single slug the permissions are named by. */
  collectionSlug: string;
  /** Active content locale, whose lifecycle decides the actions. */
  locale?: string;
  /** Whether a colleague's claim withholds writing. */
  documentLocked?: boolean;
  /**
   * Whether the user may change the document: create it, or update it. Without
   * it the page offers nothing that writes its content, while publishing,
   * unpublishing and deleting follow their own permissions.
   */
  canEdit?: boolean;
  /**
   * Whether the server refuses every write to the document whoever asks (its
   * collection or Single was removed from code): only what reads is offered,
   * and no contributed action is folded in.
   */
  writesRefused?: boolean;
  /**
   * Document actions the PAGE owns, folded in with the built-in ones.
   *
   * Descriptions rather than rendered controls, so placement, ordering and
   * disabled reasons stay this module's answer. A rendered node decides all
   * three where it is written, and a control with no way to carry a reason has
   * to disappear when a permission withholds it — which an author cannot
   * distinguish from a feature that does not exist.
   */
  contributedActions?: readonly ContributedAction[];
  /**
   * What a plugin does with a built-in action on this collection's documents:
   * hides it, or keeps its row and runs its own `open` in place of the
   * built-in write. A replaced action is offered exactly where the built-in
   * would be, with every reason it cannot run, so a permission, a colleague's
   * lock or a past version on screen still holds it.
   */
  actionOverrides?: DocumentActionOverrides;
  /**
   * The form's current values, unsaved edits included, which a contributed
   * action is told when it is chosen.
   */
  currentValues?: () => Record<string, unknown>;
  /** Whether the form holds unsaved edits, told to a contributed action with its values. */
  currentDirty?: () => boolean;

  /** Saves with no intent: the save of a collection with no status column. */
  onSubmit?: () => Promise<SubmitOutcome>;
  /** Save Draft — `handleSubmit('save-draft')`. Used in create mode and when
   *  editing a draft entry. */
  onSaveDraft?: StoringHandler;
  /** Publish — `handleSubmit('publish')`. Used in create mode and when
   *  promoting a draft to published. */
  onPublish?: StoringHandler;
  /** Save changes — `handleSubmit('save-changes')`. Used when editing a
   *  published entry on a NON-drafts collection; submits dirty fields with
   *  status="published" so the lifecycle stays the same. */
  onSaveChanges?: StoringHandler;
  /** Save working draft — `handleSubmit('save-working-draft')`. Used when
   *  editing a published entry on a drafts-enabled collection: stores a pending
   *  working draft (status-less) instead of writing the live row. */
  onSaveWorkingDraft?: StoringHandler;
  /** Unpublish — `handleSubmit('unpublish')`. Runs only once the author
   *  confirms. Sends `{ status: "draft" }` with no other field changes. */
  onUnpublish?: StoringHandler;
  /** Throws away the pending working draft and reverts the editor to the live
   *  published row. Confirmed first; REJECTS on failure so the confirmation
   *  stays open for a retry. */
  onDiscardWorkingDraft?: () => void | Promise<void>;
  /** Discard / Cancel. */
  onCancel?: () => void;
  /** Delete (edit mode only). Resolves to what the delete came to. */
  onDelete?: () => Promise<DeleteOutcome>;
  /** Duplicate (edit mode only). When provided, the action is offered. */
  onDuplicate?: () => void;
  /** Opens the API response view. */
  onViewApi?: () => void;
  /**
   * Changes from the author's last visit that were never saved, on offer in a
   * view that shows the offer in its own save chip (the page builder).
   *
   * While one waits and the document is otherwise untouched, Save is offered
   * rather than held for "nothing has changed", and it keeps those changes:
   * it restores them, then saves. Absent everywhere else (the entry and
   * Single pages make the offer in a banner), so Save there waits for an edit
   * as it always has.
   */
  pendingRecovery?: PendingRecovery | null;
  /** The workflow's next step, where a workflow is attached. */
  review?: DocumentReviewBinding;
}

/**
 * What came of keeping the changes on offer: the restore's own answer, or
 * `edited` when the author changed the document while the point was being
 * checked, so nothing was restored over that edit.
 */
export type KeepOutcome = RestoreOutcome | "edited";

/** A recovery point on offer that Save can keep; see `pendingRecovery`. */
export interface PendingRecovery {
  /**
   * Restores it into the document, answering what came of that. Asks
   * `stillWanted` just before writing anything, and writes nothing (answering
   * `edited`) when it says no.
   */
  restoreChecked: (stillWanted: () => boolean) => Promise<KeepOutcome>;
  /** Stops offering it. */
  dismiss: () => void;
}

/**
 * What running one action came to.
 *
 * `cancelled` is its own answer, never a refusal or a failure: the author was
 * asked and said no, which is not an error to report, retry or count.
 */
export type DocumentActionOutcome =
  | { ok: true; item?: { id: string } }
  | {
      ok: false;
      reason: SubmitRefusal | "cancelled";
      message: string;
      /**
       * Set where the store stopped before any write, readying the editor's
       * work: no write failed, so nothing but this outcome says why.
       */
      beforeWrite?: true;
      /** Set where the author has already been told, so nothing says it again. */
      reported?: true;
    };

/** A confirmation an action asks before it runs. */
export interface ActionConfirmation {
  open: boolean;
  /** Asks. Resolves with what the answer led to. */
  request: () => Promise<DocumentActionOutcome>;
  /** The author confirmed. */
  confirm: () => Promise<void>;
  /** The confirmation closed without confirming. */
  dismiss: () => void;
}

export interface DocumentActionBindings {
  /** Every action, in the order and placement the model gives it. */
  actions: EditorDocumentAction[];
  /** The action that leads, when one does. */
  primary: EditorDocumentAction | undefined;
  /** What each action's control runs, and why it cannot at this instant. */
  bindings: Record<string, ActionBinding | undefined>;
  /**
   * Runs one action as its control would, and says what it came to. Refuses,
   * without running anything, an action that is not offered or cannot run at
   * this instant, in the same words its control would show.
   */
  run: (id: string) => Promise<DocumentActionOutcome>;
  /**
   * The status the active language's lifecycle is in. The history panel's
   * restore reports against it, so it reads it from here rather than deciding
   * it a second time.
   */
  effectiveStatus: ReturnType<typeof effectiveEntryStatus>;
  /** When the work was last stored in this session, or null before that. */
  lastStoredAt: Date | null;
  /** The confirmations Unpublish and Discard draft ask. */
  confirmations: {
    unpublish: ActionConfirmation;
    discardDraft: ActionConfirmation;
  };
  /**
   * Asks to be run before every action that stores the editor's work, and
   * returns how to stop asking. A surface holding work the form does not have
   * yet — an edit still open — commits it here. Throwing refuses the action.
   */
  registerBeforeAction: (handler: BeforeDocumentAction) => () => void;
  /**
   * Tracks a write the document depends on but does not contain. Storing
   * actions wait for it, and are refused, naming it, while its latest attempt
   * has failed.
   */
  trackWrite: (label: string, write: Promise<unknown>) => void;
  /** Whether a tracked write is still on its way. */
  writesPending: boolean;
  /**
   * The Save the document's state calls for, run as its control runs it —
   * every open edit committed and tracked write settled first — wherever that
   * Save stores without publishing; absent where it would publish. For a
   * refused publish's way out, which must never put anything live.
   */
  saveWithoutPublishing: (() => Promise<DocumentActionOutcome>) | undefined;
  /**
   * Whether the document's work is stored, as one value every surface reads,
   * so no two of them can say different things.
   */
  saveState: DocumentSaveState;
  /**
   * Whether Save keeps changes on offer from the last visit, rather than
   * storing edits (see `pendingRecovery`): the save shortcut offers itself
   * then, as the Save control does.
   */
  keepsOffer: boolean;
  /**
   * The storing action under way (`save`, `publish`), or null: what a
   * surface naming the work on each action's own control reads, since
   * `saveState` says "saving" for both and for a tracked write alone.
   */
  storingAction: string | null;
  /**
   * Which action the failure `saveState` reports came from: `publish` for a
   * failed Publish, `save` for every other failure (a Save, a tracked write,
   * changes on offer that couldn't be kept), or null while nothing failed.
   */
  failedAction: string | null;
  /**
   * Whether the form holds unsaved work, a field's held work included: what
   * `saveState` stops saying while a store runs or after one failed.
   */
  dirty: boolean;
  /**
   * What a failed write the document depends on (a site-wide Design change)
   * says, or null: what a surface naming each action's failure on its own
   * control reads while `saveState` still reports a failed Publish.
   */
  writeFailure: string | null;
  /** Where the document is in its life, for a surface that says so itself. */
  lifecycle: DocumentLifecycle;
  /**
   * Publishes what is on screen, as the header's Publish does: the offered
   * Publish where the model offers one, and otherwise, on a published
   * document of a drafts collection holding unsaved edits but no saved
   * working draft, the same publish of those edits (the header saves them
   * first there, then publishes). Undefined where neither applies.
   */
  publishLatest: (() => Promise<DocumentActionOutcome>) | undefined;
}

/** A document's place in its life, as the actions read it. */
export interface DocumentLifecycle {
  /** Whether the collection has a Draft/Published lifecycle at all. */
  hasStatus: boolean;
  /** Whether a published document keeps its edits as a working draft. */
  draftsEnabled: boolean;
  /** Whether this person may publish it. */
  canPublish: boolean;
  /** The active language's lifecycle status. */
  status: "draft" | "published";
  /** Whether saved changes wait beside the live version. */
  hasWorkingDraft: boolean;
  /** Whether the document has ever been public, on record. */
  everPublished: boolean;
  /**
   * When the live version went live, where it is live and known: the live
   * row's own time, which a working draft's save leaves alone.
   */
  liveSince: Date | null;
}

/**
 * Whether the document's work is stored.
 *
 * - `saving`: a write is in flight — a submit, a storing action readying the
 *   work, or a tracked write the page depends on.
 * - `failed`: the last Save or Publish did not store, or a tracked write's
 *   latest attempt failed. `retry` runs a failed Save or Publish again; it
 *   lasts for this session only, since the offer to restore unsaved work
 *   covers a reload. A failed tracked write has none: see `retry`.
 * - `unsaved`: there is unsaved work, including work a field holds.
 * - `saved`: none of those; `at` is when this session last stored, or null
 *   when it has not.
 *
 * A save refused as busy, or a question the author dismissed, changes nothing:
 * the save in flight answers for itself, and saying no is not a failure.
 */
export type DocumentSaveState =
  | { kind: "saved"; at: Date | null }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | {
      kind: "failed";
      message: string;
      /**
       * Runs the failed action again. Absent when nothing here can: a tracked
       * write belongs to the surface that started it, and only that surface
       * can write it again.
       */
      retry?: () => Promise<DocumentActionOutcome>;
    };

/**
 * Run before an action that stores the editor's work; given its id, and how
 * to wait for the writes the store depends on.
 */
export type BeforeDocumentAction = (
  action: string,
  store: StoreReadiness
) => void | Promise<void>;

/** What a before-action handler may ask of the store it runs before. */
export interface StoreReadiness {
  /**
   * Waits for every write the document depends on but does not contain (see
   * `useTrackedWrite`), and answers whether they all landed. A handler that
   * acts on the server for the store, beyond committing work to the form,
   * asks this first and acts only on `true`: on `false` the store is refused,
   * and anything the handler did would stand without it.
   */
  writesSettled(): Promise<boolean>;
  /**
   * Gives the store a check to make once every handler has run and every
   * tracked write has settled, immediately before it writes, with nothing
   * awaited in between. A handler that judged the work (asked a question
   * about it, say) checks there that the work is still what it judged: the
   * handlers after it, and the writes the store waits for, give the author
   * time to change it. A check answering `false` runs every handler again;
   * work still changing after a few rounds is refused.
   *
   * @experimental
   */
  checkBeforeWrite(check: () => boolean): void;
}

const CANCELLED: DocumentActionOutcome = {
  ok: false,
  reason: "cancelled",
  message: "Cancelled.",
};

const DONE: DocumentActionOutcome = { ok: true };

/**
 * The no-status save of an editor that gave no way to run it. Its control still
 * submits the form natively, as it always has; only running it from elsewhere
 * is refused, rather than reporting a save nobody could observe.
 */
const submitUnavailable = (): Promise<DocumentActionOutcome> =>
  Promise.resolve({
    ok: false,
    reason: "refused",
    message: "This editor can't run its save from here.",
  });

/**
 * A confirmation that answers whoever asked it.
 *
 * At most one question is open at a time: asking again while it is open joins
 * the open one rather than stacking a second, which is what pressing the
 * control twice already did.
 */
function useActionConfirmation(
  act: () => Promise<DocumentActionOutcome>,
  {
    closeFirst,
  }: {
    /**
     * Close before the action runs rather than once it succeeds. Unpublish is
     * one small write whose toast reports the result; discarding keeps its
     * progress on screen and stays open on failure for a retry.
     */
    closeFirst: boolean;
  }
): ActionConfirmation {
  const [open, setOpen] = useState(false);
  const pending = useRef<{
    promise: Promise<DocumentActionOutcome>;
    answer: (outcome: DocumentActionOutcome) => void;
  } | null>(null);
  // Set while a confirmed action that keeps the question open is running. A
  // dismissal then (Escape, or a click outside) is ignored: the action cannot
  // be called back, so answering "cancelled" would tell the caller nothing
  // happened while the write goes on and may succeed.
  const confirming = useRef(false);

  return {
    open,
    request: () => {
      if (pending.current === null) {
        let answer: (outcome: DocumentActionOutcome) => void = () => {};
        const promise = new Promise<DocumentActionOutcome>(resolve => {
          answer = resolve;
        });
        pending.current = { promise, answer };
      }
      setOpen(true);
      return pending.current.promise;
    },
    confirm: async () => {
      const asked = pending.current;
      if (closeFirst) {
        // Answered here, synchronously, before anything awaits: closing the
        // dialog reports a dismissal straight after the click, and that must
        // find no question left to cancel.
        pending.current = null;
        setOpen(false);
        asked?.answer(await act());
        return;
      }
      // A second confirm while the first runs (a double click, before the
      // pending state reaches the dialog) is the same answer given twice, not
      // a second action: the first one's outcome is the answer.
      if (confirming.current) return;
      confirming.current = true;
      try {
        const outcome = await act();
        pending.current = null;
        setOpen(false);
        asked?.answer(outcome);
      } catch {
        // Stay open for a retry; its error was already surfaced by the
        // mutation's own toast, and the question is still being asked.
      } finally {
        confirming.current = false;
      }
    },
    dismiss: () => {
      if (confirming.current) return;
      const asked = pending.current;
      pending.current = null;
      setOpen(false);
      asked?.answer(CANCELLED);
    },
  };
}

/** What a storing handler's answer means as an action's outcome. */
async function stored(
  handler: StoringHandler | undefined
): Promise<DocumentActionOutcome> {
  const outcome = await handler?.();
  return outcome ?? DONE;
}

export function useDocumentActionBindings({
  mode,
  hasStatus,
  draftsEnabled = false,
  isSubmitting = false,
  isInvalid = false,
  isDirty = false,
  formId = "entry-form",
  entry,
  collectionSlug,
  locale,
  documentLocked = false,
  canEdit = true,
  writesRefused = false,
  contributedActions = [],
  actionOverrides = {},
  currentValues,
  currentDirty,
  onSubmit,
  onSaveDraft,
  onPublish,
  onSaveChanges,
  onSaveWorkingDraft,
  onUnpublish,
  onDiscardWorkingDraft,
  onCancel,
  onDelete,
  onDuplicate,
  onViewApi,
  pendingRecovery,
  review,
}: DocumentActionBindingsInput): DocumentActionBindings {
  const { defaultLocale } = useLocalization();
  // True while the document area is showing a past version rather than the
  // live document.
  const { viewing: viewingVersion } = useDocumentHistory();
  const isReadingHistory = viewingVersion !== null;
  const leaveWithoutWarning = useLeaveWithoutWarning();

  // What a storing action waits for, and what the last one came to, for this
  // document in this language.
  const gate = useStoringGate(storingScope(collectionSlug, entry, locale));
  const { storing } = gate;

  const unpublishConfirmation = useActionConfirmation(
    () => stored(onUnpublish),
    { closeFirst: true }
  );
  const discardDraftConfirmation = useActionConfirmation(
    async () => {
      await onDiscardWorkingDraft?.();
      return DONE;
    },
    { closeFirst: false }
  );

  // Publishing is its own permission, distinct from editing. Without it the
  // Publish affordance is hidden — matching the server, which refuses a write
  // that moves a document into `published` from a caller lacking it. An author
  // keeps Save Draft and stops there. Unpublish is gated separately, since
  // taking content down is a different responsibility from putting it up.
  const canPublishDocument = useCan(`publish-${collectionSlug}`);
  const canUnpublishDocument = useCan(`unpublish-${collectionSlug}`);

  // - hasStatus + create or hasStatus+edit+draft → Save Draft + Publish
  //   (the user is working on something not yet live).
  // - hasStatus + edit + published → Save changes + Unpublish (the user
  //   is editing live content). Save changes is disabled when there are
  //   no dirty edits — there's nothing to save in that state, so the
  //   button greys out and Unpublish becomes the only enabled action.
  // - !hasStatus → single Save button (collections without drafts).
  // On a localized draft collection each language has its own lifecycle, so the
  // active locale's status — not the main/default row's — decides which submit
  // affordances to show. Shared with the slug freeze and the public-URL notice,
  // which ask the same question and must not answer it differently.
  const effectiveStatus = effectiveEntryStatus(entry, locale, defaultLocale);
  const isPublishedEditState =
    mode === "edit" && effectiveStatus === "published";
  // A published entry that has a pending working draft: the server flags the
  // overlay read with `_isWorkingDraft`, and overlays only a draft it holds.
  // Read off the entry rather than the collection's `draftsEnabled`, since a
  // collection that stopped holding drafts can still hold one saved before,
  // which the editor must be able to see and discard (the server refuses to
  // publish it, since it names no language).
  const hasWorkingDraft =
    (entry as { _isWorkingDraft?: boolean } | null | undefined)
      ?._isWorkingDraft === true;
  // The "Discard draft" revert is offered for a Changed document (a pending
  // working draft over a published row). The server authorizes it as an update,
  // and the working-draft split is code-first only, so update can be granted by a
  // collection `access.update` rule that the flat `update-{slug}` permission does
  // not list. Gating on that permission here would hide Discard from an editor who
  // can create and keep saving the very draft this reverts, so it is not gated on
  // it — the sibling Save affordances are not either, and the endpoint refuses if
  // the caller truly may not update.
  const showDiscardDraft = hasWorkingDraft && !!onDiscardWorkingDraft;
  /*
   * What an author may do to this document, and what each verb runs.
   *
   * The two are separate on purpose. `documentVerbs` is about permissions and
   * document state and is decided in a module with no React in it, so every
   * combination is testable without rendering a header. The BINDINGS below are
   * about this form at this instant — mid-submit, invalid, nothing changed —
   * which only the form knows, and about which handler a verb runs, which only
   * the host knows.
   */
  const builtInVerbs = documentActions({
    mode,
    hasStatus,
    draftsEnabled: draftsEnabled === true,
    status: effectiveStatus === "published" ? "published" : "draft",
    hasWorkingDraft: hasWorkingDraft === true,
    readingHistory: isReadingHistory,
    canEdit,
    canPublish: canPublishDocument,
    canUnpublish: canUnpublishDocument,
    canDelete: onDelete !== undefined,
    isDirty: isDirty === true,
    canDuplicate: onDuplicate !== undefined,
    writesRefused,
    ...(review === undefined ? {} : { review: review.state }),
  });
  // A plugin's overrides, applied to what the model offers and to what each
  // verb runs, so the row, its control and `run` agree about them.
  const documentVerbs = withActionOverrides(builtInVerbs, actionOverrides);

  const keep = useKeepOfferedChanges({
    pendingRecovery,
    isDirty,
    lastStore: gate.lastStore,
    scope: storingScope(collectionSlug, entry, locale),
  });
  const moment = keep.moment(isSubmitting, isDirty);
  const { reasons: momentReasons, refusalFor } = refusalReasons({
    isSubmitting: moment.isSubmitting,
    isInvalid,
    isDirty: moment.isDirty,
    documentLocked,
    isPublishedEditState,
  });
  const reasons = withHeldReasons(momentReasons, actionOverrides, builtInVerbs);

  // Saving means three different calls depending on where the work lands, a
  // fact about this host rather than the document: a drafts-enabled published
  // entry stores a working draft and leaves the live one alone, a
  // drafts-disabled one re-asserts published, and anything else writes a
  // draft. The model names ONE verb, `save`; its label says which.
  const runSave = saveFor({
    isPublishedEditState,
    draftsEnabled,
    onSaveDraft,
    onSaveChanges,
    onSaveWorkingDraft,
  });
  const builtIn = builtInPerformers({
    hasStatus,
    runSave,
    onSubmit,
    onPublish,
    storing,
    onDuplicate,
    onViewApi,
    discardDraft: offeredIf(showDiscardDraft, discardDraftConfirmation.request),
    onCancel: leavingDeliberately(onCancel, leaveWithoutWarning),
    unpublish: offeredIf(
      onUnpublish !== undefined,
      unpublishConfirmation.request
    ),
    onDelete,
  });
  const performers = overriddenPerformers(
    keep.withKeepingSave(builtIn),
    actionOverrides
  );

  // The workflow's steps, each run through the review's own handler. A step
  // stores nothing of the form, so only a save in flight holds it here; the
  // model gives every other reason (a past version, unsaved edits).
  const stepPerformers = reviewStepPerformers(review);
  const performersWithSteps = { ...performers, ...stepPerformers };
  const actionBindings = {
    ...withHeldRecoveries(
      bindingsFor(performers, reasons, {
        // A submit-typed control submits the form natively and never calls
        // back; `run` calls the performer, which submits the same way.
        submitForm: hasStatus ? undefined : formId,
      }),
      actionOverrides,
      builtInVerbs
    ),
    ...reviewStepBindings(stepPerformers, isSubmitting),
  };

  /*
   * One merge for both halves. Splitting them would let the bar draw a built-in
   * verb wired to a contribution that lost its collision — Delete, from the
   * model, running somebody else's handler.
   *
   * A past version on screen withholds the page's contributions entirely, the
   * same treatment the model gives the built-in writes: they act on the LIVE
   * document, which is not what is on screen, and a contributor cannot be
   * expected to know about history — the header is where that knowledge lives.
   */
  const withContributions = acceptContributions(
    documentVerbs,
    actionBindings,
    // A contribution acts on the document too (adding it to a release), which
    // is not offered where every write to it is refused.
    isReadingHistory || writesRefused
      ? []
      : heldUnderLock(
          withoutHiddenIds(contributedActions, actionOverrides),
          documentLocked
        ),
    currentValues,
    currentDirty
  );

  const run = (id: string): Promise<DocumentActionOutcome> =>
    runAction(id, {
      offered: withContributions,
      builtIn: { performers: performersWithSteps, bindings: actionBindings },
      refusalFor,
    });

  keep.track({ save: builtIn.save, run });

  const saveState = deriveSaveState({
    isSubmitting: moment.isSubmitting,
    isDirty,
    gate,
    run,
    keepRefusal: keep.refusal,
  });

  return {
    actions: withContributions.actions,
    primary: withContributions.actions.find(
      action => action.placement === "primary"
    ),
    bindings: withContributions.bindings,
    run,
    effectiveStatus,
    confirmations: {
      unpublish: unpublishConfirmation,
      discardDraft: discardDraftConfirmation,
    },
    registerBeforeAction: gate.registerBeforeAction,
    trackWrite: gate.trackWrite,
    writesPending: gate.writesPending,
    saveWithoutPublishing: storingWithoutPublishing(
      hasStatus,
      saveWithoutPublishing(runSave, onSaveChanges),
      storing
    ),
    saveState,
    keepsOffer: keep.waiting,
    lastStoredAt: storedAt(gate.lastStore),
    storingAction: gate.storingAction,
    failedAction: failedActionOf(saveState, gate.lastStore, keep.refusal),
    dirty: isDirty,
    writeFailure:
      gate.trackedFailure === null
        ? null
        : trackedFailureMessage(gate.trackedFailure),
    lifecycle: {
      hasStatus,
      draftsEnabled,
      canPublish: canPublishDocument,
      status: effectiveStatus === "published" ? "published" : "draft",
      hasWorkingDraft,
      everPublished:
        effectiveStatus === "published" || everPublishedOnRecord(entry),
      liveSince:
        effectiveStatus === "published" ? timeOf(entry?.updatedAt) : null,
    },
    publishLatest: latestPublish({
      offered: withContributions.actions.some(
        action => action.id === "publish"
      ),
      run,
      publishEdits:
        isPublishedEditState &&
        hasStatus &&
        draftsEnabled &&
        canPublishDocument &&
        canEdit &&
        isDirty &&
        !isReadingHistory &&
        !writesRefused
          ? performers.publish
          : undefined,
      reason: reasons.publish,
      refusalFor,
    }),
  };
}

/**
 * Which action the failure the save state reports came from; see
 * `DocumentActionBindings.failedAction`.
 */
function failedActionOf(
  saveState: DocumentSaveState,
  lastStore: StoringGate["lastStore"],
  keepRefusal: KeepRefusal | null
): string | null {
  if (saveState.kind !== "failed") return null;
  if (keepRefusal === null && lastStore.kind === "failed") {
    return lastStore.action;
  }
  return "save";
}

/** A time the server sent, or null where it isn't one. */
function timeOf(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

/**
 * Publish, where the model offers it, and otherwise a published document's
 * unsaved edits published as the header's Publish would publish them: the
 * same performer, refused for the same reasons Publish is.
 */
function latestPublish({
  offered,
  run,
  publishEdits,
  reason,
  refusalFor,
}: {
  offered: boolean;
  run: (id: string) => Promise<DocumentActionOutcome>;
  publishEdits: Performer | undefined;
  reason: string | undefined;
  refusalFor: (reason: string) => SubmitRefusal;
}): (() => Promise<DocumentActionOutcome>) | undefined {
  if (offered) return () => run("publish");
  if (publishEdits === undefined) return undefined;
  return () =>
    reason === undefined
      ? publishEdits()
      : Promise.resolve({
          ok: false,
          reason: refusalFor(reason),
          message: reason,
        });
}

/**
 * The page's contributions, less any under the id of an action a plugin
 * hides. A built-in wins an id collision, so such a contribution is dropped
 * while the built-in stands; once hidden, the built-in no longer stands in
 * the merge, and without this its id would pass to the contribution.
 */
function withoutHiddenIds(
  contributed: readonly ContributedAction[],
  overrides: DocumentActionOverrides
): readonly ContributedAction[] {
  return contributed.filter(
    entry => overrideOf(overrides, entry.action.id)?.kind !== "hidden"
  );
}

/**
 * The model's actions with a plugin's overrides applied: a hidden action is
 * not offered, and a replaced one keeps its place, its flags and every reason
 * it cannot run, under the plugin's label where it gave one.
 */
function withActionOverrides(
  actions: readonly EditorDocumentAction[],
  overrides: DocumentActionOverrides
): EditorDocumentAction[] {
  return actions.flatMap(action => {
    const override = overrideOf(overrides, action.id);
    if (override === undefined || override.kind === "held") return [action];
    if (override.kind === "hidden") return [];
    return [
      override.label === undefined
        ? action
        : { ...action, label: override.label },
    ];
  });
}

/** The override for an action id, when the id is one a plugin may override. */
function overrideOf(
  overrides: DocumentActionOverrides,
  id: string
): DocumentActionOverride | undefined {
  return Object.hasOwn(overrides, id)
    ? overrides[id as OverridableDocumentAction]
    : undefined;
}

/**
 * The moment's reasons, with a held action's own reason where nothing more
 * decisive already holds it: a colleague's lock or a save in flight still
 * speaks first.
 */
function withHeldReasons(
  reasons: Partial<Record<BuiltInActionId, string | undefined>>,
  overrides: DocumentActionOverrides,
  actions: readonly EditorDocumentAction[]
): Partial<Record<BuiltInActionId, string | undefined>> {
  const result = { ...reasons };
  for (const action of actions) {
    const override = overrideOf(overrides, action.id);
    if (override?.kind !== "held") continue;
    const id = action.id as BuiltInActionId;
    // Named by the row's own label, so the reason cannot name another verb.
    result[id] = result[id] ?? override.reason(action.label);
  }
  return result;
}

/**
 * Each held action's binding with its way out, where the hold offers one and
 * is what holds it now: a lock or a save in flight is not one Retry ends.
 */
function withHeldRecoveries(
  bindings: Record<string, ActionBinding | undefined>,
  overrides: DocumentActionOverrides,
  actions: readonly EditorDocumentAction[]
): Record<string, ActionBinding | undefined> {
  const result = { ...bindings };
  for (const action of actions) {
    const override = overrideOf(overrides, action.id);
    const binding = result[action.id];
    if (override?.kind !== "held" || override.retry === undefined) continue;
    if (binding?.disabledReason !== override.reason(action.label)) continue;
    result[action.id] = { ...binding, recovery: override.retry };
  }
  return result;
}

/**
 * What each built-in action runs once a plugin's overrides apply. A hidden
 * action runs nothing, so it is not offered and `run` refuses it as not
 * offered; a replaced one runs the plugin's `open`, and only where the
 * built-in would have run at all, so no permission is widened by it.
 */
function overriddenPerformers(
  performers: Partial<
    Record<BuiltInActionId, () => Promise<DocumentActionOutcome>>
  >,
  overrides: DocumentActionOverrides
): Partial<Record<BuiltInActionId, () => Promise<DocumentActionOutcome>>> {
  const result = { ...performers };
  for (const id of Object.keys(result) as BuiltInActionId[]) {
    const override = overrideOf(overrides, id);
    if (override === undefined || override.kind === "held") continue;
    if (override.kind === "hidden") delete result[id];
    else result[id] = override.open;
  }
  return result;
}

/**
 * Each built-in action's control: `onSelect` runs the performer, so a click
 * and `run` cannot do different things, and carries why it cannot run now.
 */
function bindingsFor(
  performers: Partial<
    Record<BuiltInActionId, () => Promise<DocumentActionOutcome>>
  >,
  reasons: Partial<Record<BuiltInActionId, string | undefined>>,
  options: { submitForm: string | undefined }
): Record<string, ActionBinding | undefined> {
  const bindings: Record<string, ActionBinding | undefined> = {};
  for (const [id, perform] of Object.entries(performers)) {
    const reason = reasons[id as BuiltInActionId];
    bindings[id] = {
      onSelect: () => {
        void perform();
      },
      ...(id === "save" && options.submitForm !== undefined
        ? { submitForm: options.submitForm }
        : {}),
      ...(reason === undefined ? {} : { disabledReason: reason }),
    };
  }
  return bindings;
}

/**
 * Runs one action as its control would, and says what it came to. Refuses,
 * without running anything, an action that is not offered or cannot run now,
 * in the words its control shows.
 */
function runAction(
  id: string,
  {
    offered,
    builtIn,
    refusalFor,
  }: {
    offered: {
      actions: readonly EditorDocumentAction[];
      bindings: Record<string, ActionBinding | undefined>;
    };
    builtIn: {
      performers: Partial<Record<string, () => Promise<DocumentActionOutcome>>>;
      bindings: Record<string, ActionBinding | undefined>;
    };
    refusalFor: (reason: string) => SubmitRefusal;
  }
): Promise<DocumentActionOutcome> {
  const action = offered.actions.find(each => each.id === id);
  const binding = offered.bindings[id];
  if (action === undefined || binding === undefined) {
    return Promise.resolve({
      ok: false,
      reason: "refused",
      message: "This action isn't offered for this document.",
    });
  }
  const reason = reasonFor(action, binding);
  if (reason !== undefined) {
    return Promise.resolve({
      ok: false,
      reason: refusalFor(reason),
      message: reason,
    });
  }
  // The built-in performer when this id is still the built-in action; a
  // contribution that took the id runs its own control, which says nothing
  // back beyond having run.
  const perform = builtIn.performers[id];
  if (perform !== undefined && binding === builtIn.bindings[id]) {
    return perform();
  }
  binding.onSelect();
  return Promise.resolve(DONE);
}

/** What each workflow step the person holds runs, by its action id. */
function reviewStepPerformers(
  review: DocumentReviewBinding | undefined
): Record<string, () => Promise<DocumentActionOutcome>> {
  if (review === undefined) return {};
  return Object.fromEntries(
    review.state.steps
      .filter(step => step.held)
      .map(step => [
        reviewStepActionId(step.name),
        () => review.takeStep(step.name),
      ])
  );
}

/**
 * The steps' controls: each runs its performer, and is held while a save is
 * in flight, since the step names the version the save is replacing.
 */
function reviewStepBindings(
  performers: Record<string, () => Promise<DocumentActionOutcome>>,
  isSubmitting: boolean
): Record<string, ActionBinding> {
  return Object.fromEntries(
    Object.entries(performers).map(([id, perform]) => [
      id,
      {
        onSelect: () => {
          void perform();
        },
        ...(isSubmitting ? { disabledReason: "Saving…" } : {}),
      },
    ])
  );
}

/** Which handler Save runs for where this document's work lands. */
function saveFor(host: {
  isPublishedEditState: boolean;
  draftsEnabled: boolean;
  onSaveDraft: StoringHandler | undefined;
  onSaveChanges: StoringHandler | undefined;
  onSaveWorkingDraft: StoringHandler | undefined;
}): StoringHandler | undefined {
  if (!host.isPublishedEditState) return host.onSaveDraft;
  return host.draftsEnabled ? host.onSaveWorkingDraft : host.onSaveChanges;
}

/**
 * The Save the document's state calls for, unless that Save publishes: a
 * drafts-disabled published document's Save re-asserts it live.
 */
function saveWithoutPublishing(
  runSave: StoringHandler | undefined,
  onSaveChanges: StoringHandler | undefined
): StoringHandler | undefined {
  return runSave === onSaveChanges ? undefined : runSave;
}

/**
 * That Save as a storing action, where the document has a status to keep: a
 * document without one has no Save that leaves it unpublished.
 */
function storingWithoutPublishing(
  hasStatus: boolean,
  save: StoringHandler | undefined,
  storing: StoringGate["storing"]
): (() => Promise<DocumentActionOutcome>) | undefined {
  if (!hasStatus || save === undefined) return undefined;
  return storing("save", () => stored(save));
}

/** `perform` when the action is offered here, otherwise nothing. */
function offeredIf<T>(offered: boolean, perform: T): T | undefined {
  return offered ? perform : undefined;
}

/**
 * Discard changes: says so before leaving, because this action IS the answer
 * to the unsaved-changes question, and being asked it again reads as a warning
 * rather than as the confirmation just given.
 */
function leavingDeliberately(
  onCancel: (() => void) | undefined,
  leaveWithoutWarning: () => void
): (() => void) | undefined {
  if (onCancel === undefined) return undefined;
  return () => {
    leaveWithoutWarning();
    onCancel();
  };
}

/** Which document, in which language, a store is for. */
function storingScope(
  collectionSlug: string,
  entry: EntryData | null | undefined,
  locale: string | undefined
): string {
  return JSON.stringify([collectionSlug, entry?.id ?? null, locale ?? null]);
}

/** When the last store succeeded, or null when it has not. */
function storedAt(lastStore: StoringGate["lastStore"]): Date | null {
  return lastStore.kind === "stored" ? lastStore.at : null;
}

/** An effect an action runs, answered as done once it has run. */
function doneAfter(
  effect: (() => void) | undefined
): (() => Promise<DocumentActionOutcome>) | undefined {
  if (effect === undefined) return undefined;
  return () => {
    effect();
    return Promise.resolve(DONE);
  };
}

/*
 * What each built-in action does, with its answer. A control's `onSelect` is
 * derived from this rather than written beside it, so a click and `run` can
 * never do different things. An action the host gives no way to run is not
 * in it, and so is not offered.
 */
function builtInPerformers(host: {
  hasStatus: boolean;
  runSave: StoringHandler | undefined;
  onSubmit: (() => Promise<SubmitOutcome>) | undefined;
  onPublish: StoringHandler | undefined;
  storing: StoringGate["storing"];
  onDuplicate: (() => void) | undefined;
  onViewApi: (() => void) | undefined;
  discardDraft: (() => Promise<DocumentActionOutcome>) | undefined;
  onCancel: (() => void) | undefined;
  unpublish: (() => Promise<DocumentActionOutcome>) | undefined;
  onDelete: (() => Promise<DeleteOutcome>) | undefined;
}): Partial<Record<BuiltInActionId, () => Promise<DocumentActionOutcome>>> {
  const { runSave, onPublish, storing } = host;
  /*
   * A collection with NO status column saves by SUBMITTING, with no intent.
   *
   * Every save handler a host exposes carries one, and the draft handler
   * writes `status: "draft"` — a column such a collection does not have, so
   * routing this through a callback turns both Create and Save into a failing
   * write. Its control has always been a submit button for that reason; run
   * here, it submits the same way.
   */
  const save = !host.hasStatus
    ? storing("save", host.onSubmit ?? submitUnavailable)
    : runSave === undefined
      ? undefined
      : storing("save", () => stored(runSave));
  const entries: [
    BuiltInActionId,
    (() => Promise<DocumentActionOutcome>) | undefined,
  ][] = [
    ["save", save],
    [
      "publish",
      onPublish === undefined
        ? undefined
        : storing("publish", () => stored(onPublish)),
    ],
    ["duplicate", doneAfter(host.onDuplicate)],
    ["view-api", doneAfter(host.onViewApi)],
    ["discard-draft", host.discardDraft],
    ["discard-changes", doneAfter(host.onCancel)],
    ["unpublish", host.unpublish],
    // Answered with the delete's own outcome, once the request is answered:
    // a caller that leaves the document on "done" must not leave one that
    // still exists.
    ["delete", host.onDelete],
  ];
  return Object.fromEntries(
    entries.filter(([, perform]) => perform !== undefined)
  );
}

/*
 * Why a verb cannot run at this instant, or undefined when it can.
 *
 * Separate from the model's own reasons, which are about permission and
 * document state. A save is additionally refused while a submit is in flight,
 * while the form is invalid, and — on a published document — while nothing has
 * changed, which is the existing behaviour kept rather than re-decided.
 */
export function refusalReasons({
  isSubmitting,
  isInvalid,
  isDirty,
  documentLocked,
  isPublishedEditState,
}: {
  isSubmitting: boolean;
  isInvalid: boolean;
  isDirty: boolean;
  documentLocked: boolean;
  isPublishedEditState: boolean;
}): {
  /** Why each built-in action cannot run at this instant. */
  reasons: Partial<Record<BuiltInActionId, string | undefined>>;
  /** Which refusal a reason names: the words are the ones its control shows. */
  refusalFor: (reason: string) => SubmitRefusal;
} {
  const busyReason = isSubmitting ? "Saving…" : undefined;
  /*
   * Why every write verb is refused while a colleague holds the document.
   *
   * 🔴 The handlers already refuse, so this is not what makes the document safe —
   * it is what stops the interface lying. A live Save beside a strip saying the
   * document is somebody else's invites a click that silently does nothing, which
   * reads as the editor being broken rather than as the lock working.
   *
   * Reading verbs are deliberately left alone: discarding your own unsaved
   * changes, previewing and opening history are yours to do whoever holds the row.
   */
  const lockedReason = documentLocked ? LOCKED_REASON : undefined;
  const invalidReason = isInvalid
    ? "Fix the errors on this page first."
    : undefined;
  const nothingChanged =
    isPublishedEditState && !isDirty ? NOTHING_CHANGED_REASON : undefined;
  const saveReason =
    lockedReason ?? busyReason ?? invalidReason ?? nothingChanged;
  const writeReason = lockedReason ?? busyReason;
  return {
    reasons: {
      save: saveReason,
      publish: writeReason ?? invalidReason,
      // Duplicating WRITES a new document, so it is withheld too.
      duplicate: writeReason,
      "view-api": undefined,
      "discard-draft": writeReason,
      "discard-changes": busyReason,
      unpublish: writeReason,
      delete: writeReason,
    },
    refusalFor: reason =>
      reason === busyReason
        ? "busy"
        : reason === invalidReason
          ? "invalid"
          : "refused",
  };
}

/**
 * Why Save is refused on a published document holding nothing new: what is
 * stored already is the work. Exported so a surface asking whether the work
 * is stored reads this refusal rather than a copy of its words.
 */
export const NOTHING_CHANGED_REASON = "Nothing has changed yet.";

/**
 * Why a write is refused while the document is held elsewhere.
 *
 * Says where, not who: the holder may be a colleague, an API key, or this
 * person in another tab, and the lock notice above the form names which.
 */
const LOCKED_REASON = "This document is being edited elsewhere";

/**
 * The page's contributions, with each way to publish held while a colleague
 * holds the document, as Publish is: scheduling the document or adding it to
 * a release publishes it later, which is a write the lock withholds. Other
 * contributions (a reader's own pin) write nothing of the document's and stay
 * usable. Held through the binding's transient reason, so a permission the
 * page already refused with still speaks first.
 */
function heldUnderLock(
  contributed: readonly ContributedAction[],
  documentLocked: boolean
): readonly ContributedAction[] {
  if (!documentLocked) return contributed;
  return contributed.map(entry =>
    entry.action.placement === "publish-menu"
      ? {
          ...entry,
          binding: {
            ...entry.binding,
            disabledReason: entry.binding.disabledReason ?? LOCKED_REASON,
          },
        }
      : entry
  );
}

/** The document's one save state, from the form and the storing gate. */
function deriveSaveState({
  isSubmitting,
  isDirty,
  gate,
  run,
  keepRefusal,
}: {
  isSubmitting: boolean;
  isDirty: boolean;
  gate: StoringGate;
  run: (id: string) => Promise<DocumentActionOutcome>;
  /** Why a Save could not keep the changes on offer; see `useKeepOfferedChanges`. */
  keepRefusal: KeepRefusal | null;
}): DocumentSaveState {
  if (isSubmitting || gate.inFlight) return { kind: "saving" };
  if (keepRefusal !== null) {
    return {
      kind: "failed",
      message: keepRefusal.message,
      ...(keepRefusal.retry === undefined ? {} : { retry: keepRefusal.retry }),
    };
  }
  const { lastStore, trackedFailure } = gate;
  if (lastStore.kind === "failed") {
    return {
      kind: "failed",
      message: lastStore.message,
      retry: () => run(lastStore.action),
    };
  }
  if (trackedFailure !== null) {
    // No Retry: running Save again would refuse on the same failure, every
    // time, until the change itself is written again, which only the surface
    // that made it can do. The message says where.
    return {
      kind: "failed",
      message: trackedFailureMessage(trackedFailure),
    };
  }
  if (isDirty) return { kind: "unsaved" };
  return {
    kind: "saved",
    at: lastStore.kind === "stored" ? lastStore.at : null,
  };
}

/** What a failed write the document depends on says, naming the change. */
function trackedFailureMessage(failure: {
  label: string;
  message: string;
}): string {
  return `${failure.label} wasn't saved: ${failure.message} Make that change again where you made it, and this page can then be saved.`;
}

/** A built-in action's performer, as `builtInPerformers` returns each. */
type Performer = () => Promise<DocumentActionOutcome>;

/** The latest render's Save and `run`; see `useKeepOfferedChanges`. */
interface KeepLatest {
  save?: Performer | undefined;
  run?: (id: string) => Promise<DocumentActionOutcome>;
}

/** Why a Save could not keep the changes on offer, and its Retry if any. */
interface KeepRefusal {
  message: string;
  retry?: Performer;
}

/** What each refused restore says, in the save chip. */
const KEEP_REFUSED: Record<Exclude<RestoreOutcome, "restored">, string> = {
  changed:
    "Your earlier changes weren't saved because this page changed after them.",
  unchecked:
    "Couldn't check your earlier changes, so nothing was saved. Try again.",
};

/**
 * Save, while changes from the last visit are on offer and nothing else has
 * changed: restore them, then save them.
 *
 * The restore asks first whether the point is still what was offered. Written
 * since, or gone, nothing is saved, the offer closes and the chip says why;
 * not checked (the read failed), nothing is saved, the offer stays and the
 * chip offers Retry. Never a save of the document without them, which would
 * report "Saved" over changes that are still only in the recovery point.
 *
 * Restored (the checked restore answers once the restore has reached the
 * view), the save waits one more render, so the editor and the form hold the
 * restored changes, then runs the latest render's Save directly: the render
 * it was pressed in still holds the editor's state from before the restore,
 * and its refusal reasons were decided when nothing had changed.
 *
 * Only while the document is otherwise untouched: an author who has edited
 * since saves those edits, and is never put back to the recovery point by a
 * Save. That holds while the point is checked too: an edit made meanwhile
 * means nothing is restored, and Save stores that edit.
 *
 * A refusal says why the last Save stored nothing, so it lasts until that is
 * no longer true: an edit, any store that lands, or another document or
 * language. One offering Retry lasts only while its offer still waits.
 */
function useKeepOfferedChanges({
  pendingRecovery,
  isDirty,
  lastStore,
  scope,
}: {
  pendingRecovery: PendingRecovery | null | undefined;
  isDirty: boolean;
  lastStore: StoringGate["lastStore"];
  /** The document and language stored, as `storingScope` names it. */
  scope: string;
}): {
  /** Whether changes are on offer for Save to keep. */
  waiting: boolean;
  refusal: KeepRefusal | null;
  /**
   * The form's moment as the refusal reasons and the save state read it:
   * submitting while a Save is keeping the changes (every write waits), and
   * with something to save while changes are on offer, though none is in the
   * form.
   */
  moment: (
    isSubmitting: boolean,
    isDirty: boolean
  ) => { isSubmitting: boolean; isDirty: boolean };
  /**
   * Hands over this render's Save and `run`, for a Save that keeps the
   * changes: it saves only once they have reached the document, by which
   * time the render it was pressed in is gone.
   */
  track: (now: KeepLatest) => void;
  /** The performers, with Save keeping the changes while they wait. */
  withKeepingSave: (
    performers: Partial<Record<BuiltInActionId, Performer>>
  ) => Partial<Record<BuiltInActionId, Performer>>;
} {
  const offered = pendingRecovery ?? null;
  const waiting = isDirty ? null : offered;
  const [phase, setPhase] = useState<"idle" | "checking" | "landing">("idle");
  const [refusal, setRefusal] = useState<KeepRefusal | null>(null);
  const landed = useRef<(() => void) | null>(null);
  const latest = useRef<KeepLatest>({});
  // Set while a Save is keeping the changes, so a second call (a plugin's
  // `run("save")` twice before a render) does not restore them twice.
  const running = useRef(false);
  // Whether the document has changed, as of the latest render: asked just
  // before the restore writes anything.
  const dirtyNow = useRef(isDirty);
  // The document and language on screen now, so an answer that arrives after
  // the author moved to another is not reported, or retried, there.
  const scopeNow = useRef(scope);
  useLayoutEffect(() => {
    dirtyNow.current = isDirty;
    scopeNow.current = scope;
  });

  // A render after the restore: everything it wrote has been rendered by now,
  // since it was all asked for before this render was.
  useEffect(() => {
    if (phase !== "landing") return;
    landed.current?.();
    landed.current = null;
  }, [phase]);

  // An edit since makes the refusal old news: the chip reports the edit.
  useEffect(() => {
    if (isDirty) setRefusal(null);
  }, [isDirty]);
  // So does any store that lands, and another document or language.
  useEffect(() => {
    if (lastStore.kind === "stored") setRefusal(null);
  }, [lastStore]);
  useEffect(() => {
    setRefusal(null);
  }, [scope]);
  // Retry tries the offer again, so it goes once nothing is on offer.
  useEffect(() => {
    if (offered === null) {
      setRefusal(current => (current?.retry === undefined ? current : null));
    }
  }, [offered]);

  // Rebuilt each render, as the performers it joins are.
  const keepAndSave = async (): Promise<DocumentActionOutcome> => {
    if (waiting === null) return unavailableSave();
    if (running.current) {
      return { ok: false, reason: "busy", message: "Saving…" };
    }
    running.current = true;
    try {
      return await keepThenSave(waiting);
    } finally {
      running.current = false;
      setPhase("idle");
    }
  };

  /*
   * Nothing was restored. An edit made since (while the point was checked,
   * or one the restore declined to write over) is what Save stores, as it
   * would be had it come before the press; otherwise the chip says why
   * nothing was saved. A point that changed is no longer offered either way.
   */
  const settleUnrestored = (
    outcome: Exclude<KeepOutcome, "restored">,
    offer: PendingRecovery
  ): Promise<DocumentActionOutcome> => {
    if (outcome === "changed") offer.dismiss();
    if (outcome === "edited" || dirtyNow.current) {
      return (latest.current.save ?? unavailableSave)();
    }
    const message = KEEP_REFUSED[outcome];
    setRefusal(
      outcome === "unchecked"
        ? { message, retry: () => runLatest(latest, "save") }
        : { message }
    );
    return Promise.resolve({
      ok: false,
      reason: "refused",
      message,
      reported: true,
    });
  };

  const keepThenSave = async (
    offer: PendingRecovery
  ): Promise<DocumentActionOutcome> => {
    setRefusal(null);
    setPhase("checking");
    const pressedIn = scopeNow.current;
    const samePage = () => scopeNow.current === pressedIn;
    // Written only to the page it was asked for, and over no newer edit.
    const outcome = await offer
      .restoreChecked(() => samePage() && !dirtyNow.current)
      .catch((): KeepOutcome => "unchecked");
    // Moved to another document or language meanwhile: whatever the answer,
    // it is about the one left behind, so nothing is saved or said here.
    if (!samePage()) return pageChanged();
    if (outcome !== "restored") return settleUnrestored(outcome, offer);
    await new Promise<void>(resolve => {
      landed.current = resolve;
      setPhase("landing");
    });
    // The page may have changed while the restore was drawn, too.
    if (!samePage()) return pageChanged();
    return (latest.current.save ?? unavailableSave)();
  };

  return {
    waiting: waiting !== null,
    refusal,
    // Written as each render runs, as `run` itself is rebuilt with it: the
    // value is read only after an await, never by the render that wrote it.
    track: now => {
      latest.current = now;
    },
    moment: (submitting, dirty) => ({
      isSubmitting: submitting || phase !== "idle",
      isDirty: dirty || waiting !== null,
    }),
    withKeepingSave: performers =>
      waiting === null || performers.save === undefined
        ? performers
        : { ...performers, save: keepAndSave },
  };
}

/** Runs an action through the latest render's `run`. */
function runLatest(
  latest: RefObject<KeepLatest>,
  id: string
): Promise<DocumentActionOutcome> {
  return latest.current.run?.(id) ?? unavailableSave();
}

/** A keeping Save whose page changed before it could store anything. */
function pageChanged(): Promise<DocumentActionOutcome> {
  return Promise.resolve({
    ok: false,
    reason: "refused",
    message: "Nothing was saved: the page on screen changed first.",
    reported: true,
  });
}

/** A Save that has nothing to run: refused, in words the author can act on. */
function unavailableSave(): Promise<DocumentActionOutcome> {
  return Promise.resolve({
    ok: false,
    reason: "refused",
    message: "This page can't be saved here.",
  });
}
