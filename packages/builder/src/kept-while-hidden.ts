/**
 * A panel kept mounted while it is hidden, so what is typed in it survives,
 * but not rendered again until it shows: a hidden panel draws nothing an
 * author sees, so a selection made while another tab shows costs none of it.
 *
 * @module kept-while-hidden
 */
import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { BlockInspection } from "./inspector";

/** What every panel handed here is told: whether it is the one showing. */
interface ShownOrNot {
  readonly onScreen: boolean;
}

/**
 * `panel`, rendered again whenever it shows or is shown, and while it stays
 * hidden only for a change `heard` says it must follow.
 *
 * It renders once as it hides, which tells it it left the screen, and again
 * as it shows, with what it is handed then. While hidden it keeps what it
 * last drew, so a handler drawn then still acts for what it was drawn for.
 */
export function keptWhileHidden<P extends ShownOrNot>(
  panel: React.FunctionComponent<P>,
  heard: (before: P, after: P) => boolean = () => false
): React.NamedExoticComponent<P> {
  return React.memo(
    panel,
    (before, after) =>
      !before.onScreen && !after.onScreen && !heard(before, after)
  );
}

/** What a Content tab is drawn from: the block, and the editor's page. */
interface DrawnFor {
  readonly block: Pick<BlockInspection, "nodeId">;
  readonly editor: { readonly document: BlockDocument };
}

/**
 * Whether the block a hidden Content tab was drawn for has changed: its
 * props, its CSS id or attributes, anything the page holds for it.
 *
 * Heard so what the tab holds stays the block as it is: a block's own
 * inspector can hold its commit across an await, and a commit copies the
 * block's props whole, so one built on the block as it hid would put back an
 * undo made on Style since. Advanced follows its CSS id and attributes the
 * same way. Another block selected is not heard: the tab is drawn for that
 * one when it shows.
 */
export function ownBlockChanged(before: DrawnFor, after: DrawnFor): boolean {
  const id = before.block.nodeId;
  if (after.block.nodeId !== id) return false;
  if (before.editor.document === after.editor.document) return false;
  return (
    findNode(before.editor.document.nodes, id) !==
    findNode(after.editor.document.nodes, id)
  );
}
