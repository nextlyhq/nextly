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
 * @module admin/SavePatternPrompt
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import { layerLabel } from "@nextlyhq/builder";
import { toastMutationResult } from "@nextlyhq/plugin-sdk/admin";
import * as React from "react";

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
   * What had focus when the author asked, so it can be given back.
   *
   * Read by the caller rather than here: by the time this mounts the opener has
   * already lost focus, so the gesture is the last moment it is knowable.
   */
  returnFocusTo?: HTMLElement;
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
}: SavePatternPromptProps): React.JSX.Element | null {
  if (document === null) return null;
  return (
    <SavePatternForm
      document={document}
      selectedIds={selectedIds}
      onClose={onClose}
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
    />
  );
}

/**
 * What is about to be saved, in the author's words.
 *
 * The block's own name when there is one block, a count when there are several.
 * The canvas is behind a modal by the time this is read, so "3 blocks" is the
 * only thing telling an author how much of their selection is travelling.
 *
 * Through `layerLabel`, which is what the layers panel and every refusal
 * sentence already call a block — so one block is called the same thing here as
 * everywhere else in the editor.
 */
function subjectOf(document: BlockDocument, ids: readonly string[]): string {
  if (ids.length !== 1) return `${ids.length} blocks`;
  const only = ids[0];
  const node = only === undefined ? undefined : findNode(document.nodes, only);
  return node === undefined ? "1 block" : layerLabel(node);
}

/** The save-as-pattern form, its write, and the suggestions it offers. */
function SavePatternForm({
  document,
  selectedIds,
  onClose,
  returnFocusTo,
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
      const answered = await writer.save(
        saving.document,
        saving.selectedIds,
        fields
      );
      if (answered === undefined) return false;
      toastMutationResult("Pattern saved", answered.warnings);
      return true;
    },
    // `saving` is in here even though it never changes: a snapshot taken once
    // at mount is stable by construction, and stating it is cheaper than a
    // suppression that would also hide the next dependency somebody forgets.
    [writer, saving]
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
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
    />
  );
}
