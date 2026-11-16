/**
 * A panel kept mounted while it is hidden, so what is typed in it survives,
 * but not rendered again until it shows: a hidden panel draws nothing an
 * author sees, so a selection made while another tab shows costs none of it.
 *
 * @module kept-while-hidden
 */
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

/**
 * Whether the block a hidden Content tab was drawn for has a new CSS id or
 * new attributes. Its Advanced panel follows them while hidden, as it did
 * when it was drawn on every render, so an undo made on Style is what it
 * shows when Content comes back. Another block selected is not heard: the
 * tab is drawn for that one when it shows.
 */
export function ownHtmlChanged(
  before: { readonly block: BlockInspection },
  after: { readonly block: BlockInspection }
): boolean {
  if (before.block.nodeId !== after.block.nodeId) return false;
  const was = before.block.html;
  const now = after.block.html;
  return (
    was.cssId !== now.cssId ||
    JSON.stringify(was.attributes) !== JSON.stringify(now.attributes)
  );
}
