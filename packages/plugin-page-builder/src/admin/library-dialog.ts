/**
 * What the library forms share: how a selection is named in their sentences,
 * and where focus goes when one closes.
 *
 * @module admin/library-dialog
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import { layerLabel } from "@nextlyhq/builder";

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
export function subjectOf(
  document: BlockDocument,
  ids: readonly string[]
): string {
  if (ids.length !== 1) return `${ids.length} blocks`;
  const only = ids[0];
  const node = only === undefined ? undefined : findNode(document.nodes, only);
  return node === undefined ? "1 block" : layerLabel(node);
}

/**
 * A dialog's `onCloseAutoFocus`: focus goes back where the form was opened
 * from, asked at the close, or stays with the dialog's default when there is
 * nowhere to go.
 */
export function focusAfterClose(
  returnFocusTo: (() => HTMLElement | null) | undefined
): (event: Event) => void {
  return event => {
    const target = returnFocusTo?.() ?? null;
    if (target === null) return;
    event.preventDefault();
    target.focus();
  };
}
