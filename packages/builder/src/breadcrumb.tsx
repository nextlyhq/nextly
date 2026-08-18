"use client";

/**
 * The ancestor breadcrumb: where the selected block sits, and one click to each
 * container holding it.
 *
 * The canvas answers "what does this look like" and the layers panel answers
 * "what is the whole page". Neither answers the question an author has while
 * editing one block — what am I inside — and that question is why selecting a
 * parent is otherwise a hunt: the outer container of a full-width section has
 * almost no pixels that are not covered by its own children, so clicking it on
 * the canvas is a game of finding a margin.
 *
 * **Reads the same tree the layers panel does.** `pathTo` is the one
 * implementation of "which blocks contain this one", so the trail and the
 * panel's highlight cannot name different ancestors — and the labels match the
 * palette's, because they come from the same rule.
 *
 * **A list of buttons, not a `<nav>`.** The WAI-ARIA breadcrumb pattern
 * describes navigation between pages; this moves a selection inside one
 * document and navigates nowhere. Announcing it as site navigation would send
 * a screen-reader user looking for links that do not exist, so it is a labelled
 * list whose items are buttons.
 *
 * @module breadcrumb
 */

import { ChevronRight } from "lucide-react";
import type * as React from "react";

import type { EditorState } from "./editor-state";
import { pathTo } from "./layers";

export interface SelectionBreadcrumbProps {
  /** The editor whose selection this describes and changes. */
  editor: EditorState;
}

export function SelectionBreadcrumb({
  editor,
}: SelectionBreadcrumbProps): React.JSX.Element | null {
  const path = pathTo(editor.document, editor.selectedId);

  /*
   * Nothing selected, or a selection the document no longer holds.
   *
   * Renders NOTHING rather than an empty bar. The bar would reserve height for
   * a trail that is not there, so the canvas would resize every time a
   * selection was cleared — and an undo that removes the selected node clears
   * it, which is a routine action rather than an edge case.
   */
  if (path.length === 0) return null;

  return (
    <ol className="nx-breadcrumb" aria-label="Selected block's ancestors">
      {path.map((node, index) => {
        const isCurrent = index === path.length - 1;
        return (
          <li className="nx-breadcrumb__item" key={node.id}>
            {index > 0 ? (
              <ChevronRight
                className="nx-breadcrumb__separator"
                size={12}
                aria-hidden="true"
              />
            ) : null}
            <button
              type="button"
              className="nx-breadcrumb__crumb"
              // The last crumb IS the selection, so it is rendered as the
              // current position rather than as a way to reach it. Left
              // clickable and marked current: pressing it is harmless, and
              // disabling it would take the trail's end out of the tab order
              // for no gain.
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => editor.select(node.id)}
            >
              {node.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
