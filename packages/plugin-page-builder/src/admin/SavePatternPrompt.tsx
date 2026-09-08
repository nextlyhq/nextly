"use client";

/**
 * Everything the save-as-pattern verb needs, mounted only while it is running.
 *
 * The dialog is a pure form and the write is a hook; this is the piece that
 * knows they belong to one gesture. It exists as a component rather than as a
 * hook in `BlocksField` for one reason: MOUNTING is what starts the library
 * read, so category suggestions cost a request when an author asks to save and
 * nothing when they do not. The insert panel is wired the same way and for the
 * same reason.
 *
 * The read is usually free anyway. `usePluginRoute` keys its cache by route, so
 * an author who has opened the insert panel in this session already has the
 * library and the suggestions appear immediately.
 *
 * @module admin/SavePatternPrompt
 */
import { findNode } from "@nextlyhq/blocks-engine";
import { layerLabel } from "@nextlyhq/builder";
import type { BlockToolbar } from "@nextlyhq/builder/shell";
import * as React from "react";

import { usePatternLibrary } from "./pattern-library-client";
import { useSavePattern } from "./save-pattern-client";
import { SavePatternDialog } from "./SavePatternDialog";

/**
 * The editor state, taken from a component that already declares it.
 *
 * The builder does not publish the type on its own, and restating its shape
 * here would be a second declaration that drifts the first time the editor
 * gains a field. Derived the way the insert panel's wrapper in `BlocksField`
 * derives it, from the prop of a component that has to be right.
 */
type EditorState = React.ComponentProps<typeof BlockToolbar>["editor"];

/** Props for {@link SavePatternPrompt}. */
export interface SavePatternPromptProps {
  /** Whether the author has asked to save. */
  open: boolean;
  /** The editor whose selection is being saved. */
  editor: EditorState;
  /** Called when the prompt is finished with, saved or not. */
  onClose: () => void;
}

/**
 * The form, mounted only while it is up.
 *
 * The gate is HERE rather than at the call site, and that is a decision about
 * where a branch costs least: the editor this hangs off is already the most
 * complex function in the package, and one more conditional in its body is one
 * more path through a function nothing can hold in its head. Here it is the
 * whole of a five-line component.
 *
 * Mounting is still what starts the library read, which is the behaviour the
 * gate exists to preserve — a component that rendered `null` from inside would
 * have run its hooks first.
 */
export function SavePatternPrompt({
  open,
  editor,
  onClose,
}: SavePatternPromptProps): React.JSX.Element | null {
  if (!open) return null;
  return <SavePatternForm editor={editor} onClose={onClose} />;
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
function subjectOf(editor: EditorState): string {
  const ids = editor.selection.ids;
  if (ids.length !== 1) return `${ids.length} blocks`;
  const only = ids[0];
  const node =
    only === undefined ? undefined : findNode(editor.document.nodes, only);
  return node === undefined ? "1 block" : layerLabel(node);
}

/** The save-as-pattern form, its write, and the suggestions it offers. */
function SavePatternForm({
  editor,
  onClose,
}: Omit<SavePatternPromptProps, "open">): React.JSX.Element {
  const writer = useSavePattern();
  const library = usePatternLibrary();

  // Snapshotted when the prompt mounts, not read per render. The author is
  // naming THIS selection, and the document behind the modal can still change —
  // an autosave, a collaborator, an undo the shortcut layer still hears. Saving
  // whatever the editor holds when the form is submitted would store something
  // other than what the author was looking at when they asked.
  const [saving] = React.useState(() => ({
    document: editor.document,
    selectedIds: editor.selection.ids,
    subject: subjectOf(editor),
  }));

  return (
    <SavePatternDialog
      open
      onOpenChange={next => {
        if (!next) onClose();
      }}
      subject={saving.subject}
      categories={library.categories}
      onSave={fields =>
        writer.save(saving.document, saving.selectedIds, fields)
      }
      {...(writer.error === undefined ? {} : { error: writer.error })}
    />
  );
}
