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
import { useRef, useState } from "react";

import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import { useCan } from "@admin/hooks/useCan";
import { useLocalization } from "@admin/hooks/useLocalization";

import { documentActions, type DocumentAction } from "./document-actions";
import {
  acceptContributions,
  reasonFor,
  type ActionBinding,
  type ContributedAction,
} from "./DocumentActionBar";
import { effectiveEntryStatus } from "./entry-address";
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
   * Document actions the PAGE owns, folded in with the built-in ones.
   *
   * Descriptions rather than rendered controls, so placement, ordering and
   * disabled reasons stay this module's answer. A rendered node decides all
   * three where it is written, and a control with no way to carry a reason has
   * to disappear when a permission withholds it — which an author cannot
   * distinguish from a feature that does not exist.
   */
  contributedActions?: readonly ContributedAction[];

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
}

/**
 * What running one action came to.
 *
 * `cancelled` is its own answer, never a refusal or a failure: the author was
 * asked and said no, which is not an error to report, retry or count.
 */
export type DocumentActionOutcome =
  | { ok: true; item?: { id: string } }
  | { ok: false; reason: SubmitRefusal | "cancelled"; message: string };

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
  actions: DocumentAction[];
  /** The action that leads, when one does. */
  primary: DocumentAction | undefined;
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
  /**
   * Whether the document's work is stored, as one value every surface reads,
   * so no two of them can say different things.
   */
  saveState: DocumentSaveState;
}

/**
 * Whether the document's work is stored.
 *
 * - `saving`: a write is in flight — a submit, a storing action readying the
 *   work, or a tracked write the page depends on.
 * - `failed`: the last Save or Publish did not store, or a tracked write's
 *   latest attempt failed. `retry` runs that action again; it lasts for this
 *   session only, since the offer to restore unsaved work covers a reload.
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
      retry: () => Promise<DocumentActionOutcome>;
    };

/** Run before an action that stores the editor's work; given its id. */
export type BeforeDocumentAction = (action: string) => void | Promise<void>;

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
  contributedActions = [],
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
  // A drafts-enabled published entry that has a pending working draft: the
  // server flags the overlay read with `_isWorkingDraft`. This is Payload's
  // "Changed" state — Publish promotes it and the status pill reflects it.
  const hasWorkingDraft =
    draftsEnabled &&
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
  const documentVerbs = documentActions({
    mode,
    hasStatus,
    draftsEnabled: draftsEnabled === true,
    status: effectiveStatus === "published" ? "published" : "draft",
    hasWorkingDraft: hasWorkingDraft === true,
    readingHistory: isReadingHistory,
    canPublish: canPublishDocument,
    canUnpublish: canUnpublishDocument,
    canDelete: onDelete !== undefined,
    isDirty: isDirty === true,
    canDuplicate: onDuplicate !== undefined,
  });

  const { reasons, refusalFor } = refusalReasons({
    isSubmitting,
    isInvalid,
    isDirty,
    documentLocked,
    isPublishedEditState,
  });

  const performers = builtInPerformers({
    hasStatus,
    // Saving means three different calls depending on where the work lands, a
    // fact about this host rather than the document: a drafts-enabled
    // published entry stores a working draft and leaves the live one alone, a
    // drafts-disabled one re-asserts published, and anything else writes a
    // draft. The model names ONE verb, `save`; its label says which.
    runSave: saveFor({
      isPublishedEditState,
      draftsEnabled,
      onSaveDraft,
      onSaveChanges,
      onSaveWorkingDraft,
    }),
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

  const actionBindings = bindingsFor(performers, reasons, {
    // A submit-typed control submits the form natively and never calls back;
    // `run` calls the performer, which submits the same way.
    submitForm: hasStatus ? undefined : formId,
  });

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
    isReadingHistory ? [] : contributedActions
  );

  const run = (id: string): Promise<DocumentActionOutcome> =>
    runAction(id, {
      offered: withContributions,
      builtIn: { performers, bindings: actionBindings },
      refusalFor,
    });

  const saveState = deriveSaveState({
    isSubmitting,
    isDirty,
    gate,
    run,
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
    saveState,
    lastStoredAt: storedAt(gate.lastStore),
  };
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
      actions: readonly DocumentAction[];
      bindings: Record<string, ActionBinding | undefined>;
    };
    builtIn: {
      performers: Partial<
        Record<BuiltInActionId, () => Promise<DocumentActionOutcome>>
      >;
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
  const perform = builtIn.performers[id as BuiltInActionId];
  if (perform !== undefined && binding === builtIn.bindings[id]) {
    return perform();
  }
  binding.onSelect();
  return Promise.resolve(DONE);
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
  const lockedReason = documentLocked
    ? "Someone else is editing this document"
    : undefined;
  const invalidReason = isInvalid
    ? "Fix the errors on this page first."
    : undefined;
  const nothingChanged =
    isPublishedEditState && !isDirty ? "Nothing has changed yet." : undefined;
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

/** The document's one save state, from the form and the storing gate. */
function deriveSaveState({
  isSubmitting,
  isDirty,
  gate,
  run,
}: {
  isSubmitting: boolean;
  isDirty: boolean;
  gate: StoringGate;
  run: (id: string) => Promise<DocumentActionOutcome>;
}): DocumentSaveState {
  if (isSubmitting || gate.inFlight) return { kind: "saving" };
  const { lastStore, trackedFailure } = gate;
  if (lastStore.kind === "failed") {
    return {
      kind: "failed",
      message: lastStore.message,
      retry: () => run(lastStore.action),
    };
  }
  if (trackedFailure !== null) {
    return {
      kind: "failed",
      message: `${trackedFailure.label} wasn't saved: ${trackedFailure.message}`,
      // Running Save again is the honest retry: it waits for the change to be
      // written again, and refuses until it has been.
      retry: () => run("save"),
    };
  }
  if (isDirty) return { kind: "unsaved" };
  return {
    kind: "saved",
    at: lastStore.kind === "stored" ? lastStore.at : null,
  };
}
