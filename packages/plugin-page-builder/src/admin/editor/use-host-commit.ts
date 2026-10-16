/**
 * The editor's commit to the entry form it covers.
 *
 * The form owns the field's value and its dirty flag; the editor owns the
 * document and its history until the author leaves. What crosses between them
 * while the editor is open is here: the recovery point, the report that the
 * editor holds unsaved work, the save shortcut, the exit that hands the
 * document back, and the request that the admin's chrome step aside.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/use-host-commit
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { documentAfter, type InlineEditOutcome } from "@nextlyhq/builder/shell";
import {
  useDocumentCheckpoint,
  useReportUnsavedWork,
  useSuppressAdminChrome,
} from "@nextlyhq/plugin-sdk/admin";
import { chordMatches, detectApplePlatform, parseKeys } from "@nextlyhq/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useFormState,
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { withValueAtPath } from "../snapshot-merge";

/**
 * Record the LIVE document as this author's recovery point while the editor is
 * open.
 *
 * The form cannot do this for itself. Its own recording writes the values it
 * holds, and this field's value is deliberately not among them until the editor
 * exits — so an author who spends twenty minutes laying out a page and then
 * loses the tab has, from the form's point of view, changed nothing at all. The
 * recording is what closes that gap; the commit-on-exit rule above is what
 * makes it necessary, and neither is a workaround for the other.
 *
 * Recorded as the WHOLE document rather than as this field alone, because
 * restoring a recovery point replaces the form's values wholesale: a snapshot
 * carrying only the layout would restore cleanly and blank the title beside it.
 *
 * The very document the editor opened with is deliberately not recorded. It is
 * what the server already holds, and storing it would offer the author their
 * own unmodified page back as "unsaved changes from a moment ago".
 */
function useCheckpoints<TFieldValues extends FieldValues>({
  name,
  control,
  document,
}: {
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  document: BlockDocument;
}): void {
  const values = useWatch({ control });
  const snapshot = useMemo(
    () => withValueAtPath(values as Record<string, unknown>, name, document),
    [values, name, document]
  );

  const { schedule } = useDocumentCheckpoint({ snapshot });

  /*
   * A new document object is what an edit produces — the editor's state is
   * replaced rather than mutated — so reference inequality is the signal, and
   * a render caused by anything else asks for nothing.
   */
  const openedWith = useRef(document);
  useEffect(() => {
    if (document === openedWith.current) return;
    schedule();
  }, [document, schedule]);
}

/**
 * Whether anything in the editor is work the author has not saved.
 *
 * An OPEN inline edit counts, on top of the document's own history. Inline
 * editing does not touch the document until an edit finishes, so `undoDepth` is
 * still zero while an author is typing into a block — and a navigation or an
 * access-driven removal at that moment tears the canvas down without a blur,
 * leaving the guard as the only thing that could have asked first.
 *
 * Reported for an edit that is merely OPEN rather than one known to have
 * changed something, because nothing here can tell those apart until the write
 * happens. A prompt an author dismisses costs a click; the other direction
 * costs the paragraph they were writing.
 */
export function hasUnsavedWork(
  editor: { undoDepth: number },
  inline: { editing: unknown; editingRich: unknown }
): boolean {
  return (
    editor.undoDepth > 0 ||
    inline.editing !== null ||
    inline.editingRich !== null
  );
}

/**
 * Finish whatever inline edit was open, and say what the host may now do.
 *
 * An inline edit lives in the element until it ends — that is what keeps the
 * caret still while an author types — so the document a caller is holding is
 * the one from before it, and committing that would save a page missing the
 * words they were in the middle of writing.
 *
 * Says nothing to the author: the surface reports every finished edit through
 * one callback, including the ones started here, so reporting again from this
 * return value would announce the same edit twice.
 *
 * `mayClose` is separate from the document because the two answers differ: a
 * refused passage changed nothing, so there is a perfectly good document to
 * save, and the only thing that must not happen is unmounting the editor still
 * holding the words.
 */
export function finishInlineEdit(
  inline: { commit: () => InlineEditOutcome },
  held: BlockDocument
): { document: BlockDocument; mayClose: boolean } {
  const outcome = inline.commit();
  return {
    document: documentAfter(outcome, held),
    mayClose: outcome.status !== "refused",
  };
}

/**
 * The form's save shortcut, parsed from the SAME spec the form registers.
 *
 * Asked of the shortcut library rather than written out here. A hand-rolled
 * `key === "s" && (metaKey || ctrlKey)` treats modifiers as a minimum, so it
 * also fires on Ctrl+Shift+S and Ctrl+Alt+S — which the manager rejects,
 * meaning the form does NOT save. Ctrl+Shift+S is the browser's Save As on
 * several platforms, so the author would have got a dialog, an inline edit
 * closed underneath it, and a field changed by a keystroke that saved nothing.
 */
const SAVE_CHORD = parseKeys("mod+s")[0];

/** Whether a key event is the form's save shortcut on this platform. */
function isSaveChord(event: KeyboardEvent): boolean {
  return (
    SAVE_CHORD !== undefined &&
    chordMatches(SAVE_CHORD, event.key, event, detectApplePlatform())
  );
}

/**
 * Whether this document holds unsaved work, from EITHER surface that writes it.
 *
 * The status pill otherwise reads the editor's `undoDepth` alone, which is its
 * own history and says nothing about the form — so an author who renamed the
 * page and touched no block was told the document was saved. Two surfaces now
 * write to one document, and the pill has to answer for both.
 *
 * The blocks field is COUNTED here, and an earlier version excluded it. The
 * reasoning for excluding it was that the editor owns that field and reports
 * its own history, so counting it would double the undo depth or report saved
 * work. Both halves were wrong. Double-counting cannot matter to a boolean, and
 * the form's baseline advances on a successful submit — `useEntryForm` resets
 * it — so a dirty blocks field means genuinely unsaved blocks.
 *
 * Excluding it lost the one case that has no other witness: an author who edits
 * blocks, leaves the editor, and opens it again before saving. Leaving commits
 * the document into the form, so the field is dirty; reopening builds a fresh
 * editor whose `undoDepth` is zero. With the field excluded, nothing was left
 * to say the document had unsaved work, and the pill read clean over blocks
 * that had never been saved.
 *
 * The editor's own history is taken as an argument rather than combined at the
 * call site, so "is this document dirty" is answered in one place. It is also
 * one fewer branch inside the largest component in this package, which the
 * complexity gate refuses to let grow.
 */
export function useDocumentDirty<TFieldValues extends FieldValues>(
  control: Control<TFieldValues>,
  editorDirty: boolean
): boolean {
  const { dirtyFields } = useFormState({ control });
  return editorDirty || Object.keys(dirtyFields).length > 0;
}

/**
 * Hand unsaved work to the form when the editor goes without leaving.
 *
 * The editor can be unmounted from outside: a colleague takes the document
 * over and the view turns read-only, and the lock's banner then promises the
 * author their unsaved changes are still here. The editor holding them is
 * gone, so the form has to hold them — committed into this browser's form
 * only, which saves nothing, and from which the editor reopens when the author
 * takes the document back.
 *
 * Only when there is work, and only once: a remount (React's strict mode
 * runs one) finds nothing of its own to commit, and an exit that already
 * handed the document over marks it so the unmount after it does nothing.
 *
 * @returns marks the current work as handed over
 */
function useCommitOnUnmount(
  editor: { document: BlockDocument; undoDepth: number },
  inline: { editing: unknown; editingRich: unknown },
  onCommit: (value: BlockDocument) => void
): () => void {
  const latest = useRef({ editor, inline, onCommit });
  latest.current = { editor, inline, onCommit };
  const committed = useRef(false);
  useEffect(
    () => () => {
      const held = latest.current;
      if (committed.current || !hasUnsavedWork(held.editor, held.inline)) {
        return;
      }
      committed.current = true;
      held.onCommit(held.editor.document);
    },
    []
  );
  return useCallback(() => {
    committed.current = true;
  }, []);
}

/**
 * Everything the open editor tells the form, in the order it tells it.
 *
 * One hook so the four channels below keep their order relative to one
 * another: each subscribes to or reports into the form, and they are read
 * together on the way out.
 *
 * The editor is taken by the two facts read from it, and the inline surface
 * by the three, so this module needs nothing from the one that builds them.
 */
export function useHostCommit<TFieldValues extends FieldValues>({
  name,
  control,
  editor,
  inline,
  onCommit,
  onClose,
}: {
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  editor: { document: BlockDocument; undoDepth: number };
  inline: {
    commit: () => InlineEditOutcome;
    editing: unknown;
    editingRich: unknown;
  };
  onCommit: (value: BlockDocument) => void;
  onClose: () => void;
}): { done: () => void } {
  useCheckpoints({ name, control, document: editor.document });

  /*
   * Tell the form this editor holds work its values do not contain, so the
   * navigation guard warns and the save shortcut works while the canvas is
   * open. `undoDepth` rather than comparing documents: an edit and its undo
   * leave a document equal to the original but not identical to it, so a
   * reference comparison would report work that was taken back.
   *
   * Retracted when this component unmounts, which is the same moment `done`
   * commits the document and makes the form dirty for real.
   */
  useReportUnsavedWork(`blocks:${name}`, hasUnsavedWork(editor, inline));

  /*
   * Finish an open passage before the form is asked to save it.
   *
   * An inline edit lives in the element until it ends, so the field still holds
   * the value from before it. Reporting the edit as unsaved work is what lets
   * the form submit — and reporting cannot write to the form, by that context's
   * own contract — so a save taken while a passage is open would send the
   * previous value and report success.
   *
   * Capture phase, so this runs before the form's own handler sees the chord.
   *
   * This closes the SHORTCUT. A save started any other way — a button, a
   * command palette — still leaves an open passage behind, because nothing lets
   * a surface holding uncommitted work be asked to flush before submission.
   * That is a contract the form does not have, not something this can reach.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveChord(event)) return;
      /*
       * Saved even when the passage was refused, and NOT closed either way.
       * The document is right and complete for everything except the passage
       * still open, so withholding the save would lose the rest of their work
       * to protect a paragraph that is not going anywhere: it stays in the
       * editor, on screen, and the message is what tells them it is still
       * there.
       */
      onCommit(finishInlineEdit(inline, editor.document).document);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editor.document, inline, onCommit]);

  /*
   * Writing back on the way out rather than on every keystroke.
   *
   * The form owns the value and its dirty flag; the editor owns the document
   * and its history. Committing on each change would mark the entry dirty for
   * an edit the author then undoes, and would make the form's undo and the
   * editor's undo two answers to one question.
   */
  const markCommitted = useCommitOnUnmount(editor, inline, onCommit);
  const done = useCallback(() => {
    /*
     * The open inline edit is finished FIRST, and the document it produced is
     * the one handed over.
     *
     * An inline edit lives in the element until it ends — that is what keeps
     * the caret still while an author types — so `editor.document` here is the
     * one from before it. Committing that would hand the form a document
     * missing the words the author was in the middle of writing, and the exit
     * gesture is the most common way to leave a passage open.
     */
    const finished = finishInlineEdit(inline, editor.document);
    /*
     * A REFUSED commit kept the passage open because the author's words are in
     * it and nowhere else. Closing unmounts the canvas and takes the editor
     * with it, so leaving is declined until they deal with it — they have been
     * told what happened, and their text is still where they left it.
     */
    if (!finished.mayClose) return;
    onCommit(finished.document);
    markCommitted();
    onClose();
  }, [editor.document, inline, onCommit, onClose, markCommitted]);

  /*
   * The editor takes the window: the shell draws its own rail, panels, top bar
   * and bottom bar, so admin chrome around it is a second set of the same
   * furniture, and the canvas is the one surface whose purpose is the space it
   * is given.
   *
   * `canExit` is derived from the handler passed to the shell as `onExit`, which
   * is what decides whether a way back is rendered at all. The admin withholds
   * the navigation rail from any surface that cannot be left, so a mount that
   * ever stops rendering an exit keeps its rail automatically instead of
   * stranding an author inside a full-screen editor.
   */
  useSuppressAdminChrome({
    layers: [
      "primaryRail",
      "subSidebar",
      "documentSidebar",
      "header",
      "pageFrame",
    ],
    canExit: true,
  });

  return { done };
}
