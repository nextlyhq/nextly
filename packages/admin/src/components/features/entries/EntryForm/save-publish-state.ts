/**
 * What a status-carrying Save button and Publish split button say, decided
 * apart from drawing them, so every row of each table is answerable without
 * rendering an editor.
 *
 * The pair says the document's state on its own controls: Save reads "Save",
 * "Saving…", "Retry save" or "✓ Saved", and Publish reads "Publish",
 * "Publish changes", "Publishing…", "Published" or "Scheduled". Each table
 * is FIRST MATCH WINS, most specific situation first, so the order of the
 * rows is the rule.
 *
 * @module components/features/entries/EntryForm/save-publish-state
 */
import { formatTimeAgo } from "./time-ago";
import type {
  DocumentLifecycle,
  DocumentSaveState,
} from "./useDocumentActionBindings";

/** What the Save button reads beside changes from the author's last visit. */
export const LAST_VISIT_NOTICE =
  "Changes from your last visit aren't saved yet";

/** What the Save shortcut says on a document with nothing to save. */
export const NOTHING_TO_SAVE = "Nothing to save";

/** What Save reads for the document right now. */
export interface SaveButtonInput {
  saveState: DocumentSaveState;
  /** The storing action under way, or null. */
  storingAction: string | null;
  /** Which action the reported failure came from, or null. */
  failedAction: string | null;
  /** Whether the form holds unsaved work. */
  dirty: boolean;
  /** Whether a tracked write the document depends on is on its way. */
  writesPending: boolean;
  /**
   * Whether changes from the author's last visit wait to be saved, kept by
   * Save while the document is otherwise untouched.
   */
  pendingRecovery: boolean;
  /**
   * When the work on screen was stored: this session's last store, or the
   * stored document's own time. Null where it isn't known (a working
   * draft's row keeps the published time).
   */
  savedAt: Date | null;
}

/**
 * The Save button's state. Inert states stay focusable (`aria-disabled`), so
 * their tooltip can be read from the keyboard.
 */
export type SaveButtonView =
  /** A store is under way: no control, and nothing announced. */
  | { kind: "saving"; label: "Saving…" }
  /** The last save failed: the press tries again. */
  | { kind: "retry"; label: "Retry save"; tooltip: string; reason: string }
  /** Changes from the last visit wait: the press offers Save and Discard. */
  | { kind: "offered"; label: "Save"; tooltip: string }
  /** Unsaved work: the press saves it. */
  | { kind: "save"; label: "Save"; tooltip: string }
  /** Everything is stored: quiet and inert, with when in its tooltip. */
  | { kind: "saved"; label: "Saved"; tooltip: string };

/** "Saved 2 minutes ago", or what can be said where the time isn't known. */
function savedTooltip(savedAt: Date | null): string {
  return savedAt === null
    ? "Your changes are saved"
    : `Saved ${formatTimeAgo(savedAt)}`;
}

/**
 * The Save button, first match wins:
 *
 * 1. a store under way (a Save, or a write the page depends on) — "Saving…";
 * 2. the last save failed — "Retry save", with the reason;
 * 3. changes from the last visit wait — "Save", which offers Save and
 *    Discard;
 * 4. unsaved work — "Save";
 * 5. otherwise — "✓ Saved", with when.
 *
 * A Publish under way or failed is the Publish button's to say: Save keeps
 * the label the work calls for meanwhile, so one state is said once. A write
 * the page depends on still reads "Saving…" while Publish waits for it.
 */
export function saveButtonView(input: SaveButtonInput): SaveButtonView {
  const { saveState } = input;
  const publishing = input.storingAction === "publish";
  if (saveState.kind === "saving" && (!publishing || input.writesPending)) {
    return { kind: "saving", label: "Saving…" };
  }
  if (saveState.kind === "failed" && input.failedAction !== "publish") {
    return {
      kind: "retry",
      label: "Retry save",
      tooltip: `Not saved: ${saveState.message}`,
      reason: saveState.message,
    };
  }
  if (input.pendingRecovery && !input.dirty) {
    return { kind: "offered", label: "Save", tooltip: LAST_VISIT_NOTICE };
  }
  if (input.dirty) {
    return { kind: "save", label: "Save", tooltip: "Save your changes (⌘S)" };
  }
  return {
    kind: "saved",
    label: "Saved",
    tooltip: savedTooltip(input.savedAt),
  };
}

/** A publication set for later: when the soonest one goes live. */
export interface ScheduledPublish {
  at: Date;
}

/** What the Publish button reads for the document right now. */
export interface PublishButtonInput {
  lifecycle: DocumentLifecycle;
  /** Whether the form holds unsaved work. */
  dirty: boolean;
  /** The storing action under way, or null. */
  storingAction: string | null;
  /** The soonest scheduled publication, or null where none is known. */
  scheduled: ScheduledPublish | null;
}

/** The Publish button's state; see `SaveButtonView` for the inert ones. */
export type PublishButtonView =
  | { kind: "publishing"; label: "Publishing…" }
  | { kind: "scheduled"; label: "Scheduled"; tooltip: string }
  | { kind: "publish"; label: "Publish"; tooltip: string }
  | { kind: "publish-changes"; label: "Publish changes"; tooltip: string }
  | { kind: "published"; label: "Published"; tooltip: string };

/** When a scheduled publication goes live, in words. */
export function goesLiveText(at: Date): string {
  return `Goes live ${momentText(at)}`;
}

/** A moment on the reader's own clock: "3 Dec, 09:00". */
function momentText(at: Date): string {
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Whether the Publish button is drawn: a collection with a lifecycle that
 * keeps drafts, for a person who may publish. Elsewhere Save leads alone.
 */
export function publishShown(lifecycle: DocumentLifecycle): boolean {
  return lifecycle.hasStatus && lifecycle.draftsEnabled && lifecycle.canPublish;
}

/**
 * The Publish button, first match wins:
 *
 * 1. a publish under way — "Publishing…";
 * 2. a publication scheduled (a first one included) — "Scheduled", with when
 *    it goes live: checked before history and working changes;
 * 3. never published — "Publish";
 * 4. not live now (unpublished since) — "Publish": there is no live page to
 *    be behind or to match, whatever the page's history;
 * 5. the live page is behind (unsaved work, or a saved working draft) —
 *    "Publish changes";
 * 6. otherwise — "Published", with when it went live.
 */
export function publishButtonView(
  input: PublishButtonInput
): PublishButtonView {
  const { lifecycle } = input;
  if (input.storingAction === "publish") {
    return { kind: "publishing", label: "Publishing…" };
  }
  if (input.scheduled !== null) {
    return {
      kind: "scheduled",
      label: "Scheduled",
      tooltip: goesLiveText(input.scheduled.at),
    };
  }
  if (!lifecycle.everPublished) {
    return {
      kind: "publish",
      label: "Publish",
      tooltip: "Publish this page (saves first)",
    };
  }
  if (lifecycle.status === "draft") {
    return {
      kind: "publish",
      label: "Publish",
      tooltip: "This page isn't live · publish it (saves first)",
    };
  }
  if (input.dirty || lifecycle.hasWorkingDraft) {
    return {
      kind: "publish-changes",
      label: "Publish changes",
      tooltip: "Put your changes on the live page",
    };
  }
  return {
    kind: "published",
    label: "Published",
    tooltip:
      lifecycle.liveSince === null
        ? "The live page matches this version"
        : `Live since ${momentText(lifecycle.liveSince)} · the live page matches this version`,
  };
}
