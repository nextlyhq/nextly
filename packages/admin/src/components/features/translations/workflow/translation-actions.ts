/**
 * What a person may do with one language of a document from its translation
 * page: the editor's own action model, asked about the language's part, with
 * the two verbs that act on the language named for it.
 *
 * Nothing here decides which action leads or which is held: that is
 * `documentActions`, so the page and the editor cannot come to disagree.
 *
 * @module components/features/translations/workflow/translation-actions
 */

import {
  documentActions,
  type EditorDocumentAction,
  type ReviewActionState,
} from "@admin/components/features/entries/EntryForm/document-actions";

/** The facts about the language's part the actions depend on. */
export interface TranslationActionFacts {
  /** The language's name, which its Save and Publish carry. */
  languageLabel: string;
  /** Whether the collection or Single has a publish lifecycle at all. */
  hasStatus: boolean;
  /** Whether a save of a published language is held until it is published. */
  holdsDrafts: boolean;
  /** The language's own status; absent where it has no content yet. */
  status: string | undefined;
  /** Whether a saved change of the language waits to be published. */
  pendingChange: boolean;
  /** Whether the person may change the language's text. */
  canEdit: boolean;
  /** Whether the person may publish the language. */
  canPublish: boolean;
  /** Whether the page holds unsaved work. */
  isDirty: boolean;
  /** Whether a past version is on screen, which forbids every write. */
  readingHistory: boolean;
  /** Whether the server refuses every write, as where the type was removed from code. */
  writesRefused: boolean;
  /** Where the language stands in the workflow holding publishing; absent where none does. */
  review: ReviewActionState | undefined;
}

/** The actions named for the language: they act on it alone. */
const NAMED_FOR_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ["save", "Save"],
  ["publish", "Publish"],
]);

/** The actions the person has, in the order a header draws them. */
export function translationActions(
  facts: TranslationActionFacts
): EditorDocumentAction[] {
  return documentActions({
    mode: "edit",
    hasStatus: facts.hasStatus,
    draftsEnabled: facts.holdsDrafts,
    // A language with no content has nothing live, as a draft has not.
    status: facts.status === "published" ? "published" : "draft",
    hasWorkingDraft: facts.pendingChange,
    readingHistory: facts.readingHistory,
    canEdit: facts.canEdit,
    canPublish: facts.canPublish,
    // Verbs on the whole document, or the page's own with a dialog of their
    // own: none of them is the header's here.
    canUnpublish: false,
    canDelete: false,
    canDuplicate: false,
    isDirty: facts.isDirty,
    writesRefused: facts.writesRefused,
    ...(facts.review === undefined ? {} : { review: facts.review }),
  }).map(action => {
    const verb = NAMED_FOR_LANGUAGE.get(action.id);
    return verb === undefined
      ? action
      : { ...action, label: `${verb} ${facts.languageLabel}` };
  });
}
