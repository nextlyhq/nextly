"use client";

/**
 * Everything the save-as-pattern verb needs, mounted only while it is running.
 *
 * The dialog is a pure form and the write is a hook; this is the piece that
 * knows they belong to one gesture. It exists as a component rather than as a
 * hook in `BlocksField` for two reasons: MOUNTING is what starts the library
 * read, so category suggestions cost a request when an author asks to save and
 * nothing when they do not — and the branch that decides whether to mount is a
 * branch the editor, already the most complex function in the package, does not
 * have to carry.
 *
 * The read is usually free anyway. `usePluginRoute` keys its cache by route, so
 * an author who has opened the insert panel in this session already has the
 * library and the suggestions appear immediately.
 *
 * ## The document arrives as a snapshot
 *
 * Taken by the caller at the moment the author asked, not read from the editor
 * here. Two things are true of that moment and of no later one: an open
 * rich-text passage has just been committed into it, and it is the document the
 * author was looking at. The page behind a modal can still change — an autosave,
 * an undo the shortcut layer still hears — and a form reading the live editor
 * would store something other than what was asked for.
 *
 * Except once a held component setting is refused: the refusal takes its
 * binding off the editor's document, so the snapshot binds a setting never
 * made, and a retry stores the editor's document instead.
 *
 * @module admin/SavePatternPrompt
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { toastMutationResult } from "@nextlyhq/plugin-sdk/admin";
import * as React from "react";

import { subjectOf } from "./library-dialog";
import { usePatternLibrary } from "./pattern-library-client";
import { useSavePattern } from "./save-pattern-client";
import { SavePatternDialog } from "./SavePatternDialog";

/** Props for {@link SavePatternPrompt}. */
export interface SavePatternPromptProps {
  /**
   * The document to save from, or `null` when the author has not asked.
   *
   * The open state and the subject in one value: a document means the form is
   * up, and it is the exact document that will be stored. Two fields would let
   * them disagree — a form open against a document from a different moment.
   */
  document: BlockDocument | null;
  /** The nodes to lift out of it. */
  selectedIds: readonly string[];
  /** Called when the prompt is finished with, saved or not. */
  onClose: () => void;
  /**
   * Where focus goes when the form closes, asked at that moment.
   *
   * Resolved by the caller rather than here: what had focus is knowable only at
   * the gesture, and whether it is still there is knowable only at the close.
   */
  returnFocusTo?: () => HTMLElement | null;
  /**
   * Run before the section is stored: the page's held component settings
   * written, which the selection may bind and the saved section would keep
   * binding. `false` when one was refused, and nothing is stored, so no
   * saved section binds a setting never made.
   */
  beforeSave?: () => true | Promise<boolean>;
  /**
   * The editor's document now. A refused held setting takes its binding off
   * the editor's document, not off the snapshot, so a retry after a refusal
   * saves this: the snapshot would store a binding to a setting never made.
   */
  currentDocument?: () => BlockDocument;
}

/**
 * The form, mounted only while it is up.
 *
 * The gate is HERE rather than at the call site, and that is a decision about
 * where a branch costs least: the editor this hangs off is already the most
 * complex function in the package. Here it is the whole of five lines.
 *
 * Mounting is still what starts the library read, which is the behaviour the
 * gate exists to preserve — a component that returned `null` from inside would
 * have run its hooks first.
 */
export function SavePatternPrompt({
  document,
  selectedIds,
  onClose,
  returnFocusTo,
  beforeSave,
  currentDocument,
}: SavePatternPromptProps): React.JSX.Element | null {
  if (document === null) return null;
  return (
    <SavePatternForm
      document={document}
      selectedIds={selectedIds}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      beforeSave={beforeSave}
      currentDocument={currentDocument}
    />
  );
}

/** The save-as-pattern form, its write, and the suggestions it offers. */
function SavePatternForm({
  document,
  selectedIds,
  onClose,
  returnFocusTo,
  beforeSave,
  currentDocument,
}: Omit<SavePatternPromptProps, "document"> & {
  document: BlockDocument;
}): React.JSX.Element {
  const writer = useSavePattern();
  const library = usePatternLibrary();

  // Snapshotted when the form mounts. The props are already a snapshot of the
  // moment the author asked; holding them still here is what keeps a re-render
  // of the editor behind the modal from changing which blocks the subject line
  // describes.
  const [saving] = React.useState(() => ({
    document,
    selectedIds,
    subject: subjectOf(document, selectedIds),
  }));
  // Whether a held setting was refused here: the snapshot then still binds
  // what the refusal took off the editor's document.
  const refused = React.useRef(false);

  /*
   * A save that COMMITTED is still a save, whatever ran after it.
   *
   * A post-commit hook cannot un-write the row — an unindexed pattern, a
   * webhook that did not fire — so failing the form would tell the author their
   * pattern is not there when it is, and invite them to write it twice. The
   * form closes and what happened is reported beside it.
   *
   * Through the admin's OWN presenter rather than a sentence of this module's.
   * The array carries two different things: `severity: "failure"` is something
   * that did not happen, and `"notice"` is something an author should merely
   * know — and one message for both reports a successful advisory as a failure
   * while throwing away the public message that says what it was. That split,
   * and the detail beside it, is what `toastMutationResult` already owns for
   * every write the admin makes.
   */
  const storing = React.useCallback(
    async (fields: Parameters<typeof writer.save>[2]) => {
      // A refusal is said where it happened, with the binding taken off.
      if (beforeSave !== undefined && !(await beforeSave())) {
        refused.current = true;
        return false;
      }
      const stored =
        refused.current && currentDocument !== undefined
          ? currentDocument()
          : saving.document;
      const answered = await writer.save(stored, saving.selectedIds, fields);
      if (answered === undefined) return false;
      toastMutationResult("Saved to Saved sections", answered.warnings);
      return true;
    },
    // `saving` is in here even though it never changes: a snapshot taken once
    // at mount is stable by construction, and stating it is cheaper than a
    // suppression that would also hide the next dependency somebody forgets.
    [writer, saving, beforeSave, currentDocument]
  );

  return (
    <SavePatternDialog
      open
      onOpenChange={next => {
        if (!next) onClose();
      }}
      subject={saving.subject}
      categories={library.categories}
      onSave={fields => storing(fields)}
      {...(writer.error === undefined ? {} : { error: writer.error })}
      returnFocusTo={returnFocusTo}
    />
  );
}
