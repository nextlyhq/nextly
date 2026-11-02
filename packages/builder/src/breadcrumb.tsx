"use client";

/**
 * The bottom bar: where the selected block sits on the page, one click to each
 * container holding it, and a hint at the keys that work from there.
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
import { EDITOR_WORDS } from "./editor-words";
import { firstInlineProp } from "./inline-target";
import { keyHint } from "./key-hint";
import { pathTo } from "./layers";

export interface SelectionBreadcrumbProps {
  /** The editor whose selection this describes and changes. */
  editor: EditorState;
  /**
   * The keys the host has bound, so the hint offers only what works:
   * `editText` when Enter begins editing a block's text on the canvas,
   * `commandPalette` when the command palette opens with the modifier and K.
   */
  hints?: { readonly editText?: boolean; readonly commandPalette?: boolean };
}

/** One crumb: a block, or the page itself at the trail's root. */
interface Crumb {
  readonly key: string;
  readonly label: string;
  readonly select: () => void;
}

export function SelectionBreadcrumb({
  editor,
  hints = {},
}: SelectionBreadcrumbProps): React.JSX.Element {
  /*
   * The page first, always, then the selected block's ancestors.
   *
   * With nothing selected, or a selection the document no longer holds (an
   * undo can remove the selected node), the trail is the page alone, marked
   * as the current position: the bar always says where the author is.
   */
  const path = pathTo(editor.document, editor.selectedId);
  const crumbs: Crumb[] = [
    {
      key: "page",
      label: EDITOR_WORDS.page,
      select: () => editor.select(null),
    },
    ...path.map(node => ({
      key: node.id,
      label: node.label,
      select: () => editor.select(node.id),
    })),
  ];
  const selected = path.length > 0 ? editor.selectedId : null;

  return (
    <div className="nx-bottom-bar">
      <ol className="nx-breadcrumb" aria-label="Selected block's ancestors">
        {crumbs.map((crumb, index) => (
          <li className="nx-breadcrumb__item" key={crumb.key}>
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
              aria-current={index === crumbs.length - 1 ? "true" : undefined}
              onClick={crumb.select}
            >
              {crumb.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="nx-bottom-bar__hint">{hintFor(editor, selected, hints)}</p>
    </div>
  );
}

/**
 * The bar's hint, from the keys that work right now: Enter where the host
 * edits text and the selected block has some, Escape to go up a level from
 * any selection, and the command palette where the host has one.
 */
function hintFor(
  editor: EditorState,
  selected: string | null,
  hints: NonNullable<SelectionBreadcrumbProps["hints"]>
): string {
  const parts: string[] = [];
  if (selected === null) {
    parts.push("Click a block to select it");
  } else {
    if (
      hints.editText === true &&
      firstInlineProp(editor.document, selected) !== null
    ) {
      parts.push("Enter to edit text");
    }
    parts.push("Esc to go up");
  }
  const palette = hints.commandPalette === true ? keyHint("mod+k") : null;
  if (palette !== null) parts.push(`${palette} for anything`);
  return parts.join(" · ");
}
