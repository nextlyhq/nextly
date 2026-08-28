"use client";

/**
 * The right-click menu over the canvas, and the fourth surface over the block
 * verbs.
 *
 * The keystrokes, the floating toolbar and the command palette were the first
 * three. This one exists because it is where an author looks first — Webflow,
 * Framer, Figma and Gutenberg all put the block verbs on a secondary click, so
 * an editor without one reads as broken rather than as minimal.
 *
 * ## It derives; it does not decide
 *
 * Every question this menu could ask is already answered somewhere:
 *
 * - WHICH verbs, and whether each is available, comes from `toolbarActions` —
 *   the same call the floating bar makes, with the same order and the same
 *   reasons. `builder-commands` states the rule for the palette and it is the
 *   same one here: asking a second time is how a menu comes to offer a verb the
 *   button beside it shows as unavailable.
 * - WHAT each one runs comes from `blockActionRunners`, shared with the palette
 *   so the two cannot bind the same label to different verbs.
 * - WHICH block it acts on is the canvas's selection, which the canvas itself
 *   moves to the block under the pointer before this ever opens.
 *
 * What is left is presentation, which is this module's whole job.
 *
 * ## Labels come from the toolbar, not the palette
 *
 * The palette deliberately says "Duplicate block", because a palette row is
 * read in a list with no context. A context menu is drawn AT the block, like
 * the toolbar, so it takes the toolbar's shorter "Duplicate" for the same
 * reason the toolbar does.
 *
 * ## A disabled verb stays, and says why IN THE MENU
 *
 * The reason is VISIBLE text inside the item, not a `title`. The toolbar can
 * use a tooltip because its buttons stay hoverable; a disabled menu item does
 * not, since the shared item style sets `data-[disabled]:pointer-events-none`
 * — and Radix skips disabled items in keyboard navigation, so there is no
 * route to a tooltip by either input. A `title` there is an explanation that
 * exists in the markup and reaches nobody.
 *
 * `toolbarActions` sets `reason` only for a cause an author can act on — a lock
 * — and leaves self-evident ones unsaid. So an unavailable verb is drawn
 * disabled with its reason rather than removed: a menu that silently omits
 * Delete answers "why can I not delete this" with nothing at all, and the
 * remedy for the one reason it does report is one field away.
 *
 * ## Why the trigger generates no box
 *
 * Radix's trigger renders a `span`, and a span wrapped around the canvas is an
 * inline box holding a block one — it would change the layout of the thing it
 * is meant to be transparent over. `display: contents` makes the wrapper
 * generate no box at all while leaving it in the DOM, which is all this needs:
 * events bubble along the tree rather than along the layout, and Radix anchors
 * a context menu to the pointer's own coordinates rather than to the trigger's
 * rect.
 *
 * Keeping it ABOVE the canvas root, rather than on it, is also what keeps the
 * canvas's drag handlers intact. Radix binds its own pointer handlers for the
 * touch long-press, and the canvas root already carries a full set for
 * dragging; on one element the two would overwrite each other.
 *
 * ## Touch and pen open it by a different route, and act on the same subject
 *
 * Radix opens a long-press from its own 700ms `pointerdown` timer and never
 * dispatches a `contextmenu` event, so the canvas's filtering — which runs on
 * that event — does not see it at all. Left alone, a long press on a block that
 * was not selected opens the PREVIOUS selection's verbs, and Delete among them
 * acts on a block the author is not looking at.
 *
 * The press is therefore NOTED and nothing more. Acting on it would be acting
 * on a contact that has not yet become anything: a press becomes a long press
 * only after 700ms, and most never do — selecting there retargets the
 * inspector and the toolbar every time the author scrolls the canvas with a
 * finger, and Radix's own cancellation on `pointermove` would not put it back.
 *
 * The selection moves when the menu actually OPENS, which is the first moment
 * a long press is known to be one. For a mouse the canvas has already selected
 * by then, on the context event, and the check below makes that a no-op.
 *
 * Rejecting a press aimed at chrome or at text is the canvas's job rather than
 * this one's, and it does it by withholding the event — see its pointer-down
 * rule for why `preventDefault` here would be the wrong instrument.
 *
 * ## This menu is reached by POINTER only, and that is a limitation
 *
 * Measured in a real browser: a right-click opens it correctly, at the pointer,
 * both at scale 1 and under the canvas's CSS `zoom`. Shift+F10 with the canvas
 * focused does NOT open it, and the structure says why — the focusable canvas
 * region is an ANCESTOR of this trigger, so a keyboard-invoked context event
 * originating there bubbles away from it rather than into it.
 *
 * It is shipped anyway because it takes nothing away. Every verb here is
 * already reachable without a pointer, through the keystrokes, the block
 * toolbar's roving tab stop, and the command palette — this is a fourth route
 * to them, not the only one. The fix is not to move this trigger up, which
 * would open a block menu over chrome that is not a block; it is to make the
 * blocks themselves focusable — a block is what a context-menu key should be
 * aimed at anyway, and a focusable one would carry this trigger with it.
 *
 * @module block-context-menu
 */

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { blockActionRunners } from "./builder-commands";
import { contextMenuTargetOf } from "./canvas";
import type { EditorState } from "./editor-state";
import { useBlockActionsContext } from "./keyboard-actions";
import { toolbarActions } from "./toolbar-actions";

/**
 * The wrapper's style, hoisted so it is one object rather than one per render.
 *
 * A fresh literal here would give the wrapper a new `style` prop on every
 * render of the canvas, which React writes back to the DOM each time.
 */
const TRANSPARENT_WRAPPER: React.CSSProperties = { display: "contents" };

/** Where the menu's own verbs end and the editor-wide ones would begin. */
const DESTRUCTIVE: ReadonlySet<string> = new Set(["delete"]);

export interface BlockContextMenuProps {
  /** The editor whose selection the verbs act on. */
  editor: EditorState;
  /** The canvas this menu opens over. */
  children: React.ReactNode;
}

export function BlockContextMenu({
  editor,
  children,
}: BlockContextMenuProps): React.JSX.Element {
  const verbs = useBlockActionsContext();
  const { document, selectedId } = editor;
  const selectedIds = editor.selection.ids;

  /*
   * Rebuilt on what could change WHICH verbs are offered, for the reason
   * `EditorCommandPalette` gives: `editor` itself is a fresh object every
   * render, so depending on it would rebuild this on every frame of a drag.
   */
  const actions = React.useMemo(
    () => toolbarActions(document, selectedId, selectedIds),
    [document, selectedId, selectedIds]
  );
  const run = React.useMemo(() => blockActionRunners(verbs), [verbs]);

  const select = editor.select;
  /*
   * What the last press was aimed at, remembered rather than acted on.
   *
   * A ref because nothing renders from it and because the value has to survive
   * from the press to the open without causing a render in between — a state
   * update here would rerender the canvas on every contact.
   */
  const pressedTarget = React.useRef<string | null>(null);
  const noteTarget = React.useCallback(
    (event: React.SyntheticEvent<HTMLDivElement>) => {
      pressedTarget.current = contextMenuTargetOf(event.target);
    },
    []
  );
  const opened = React.useCallback(
    (open: boolean) => {
      // CONSUMED, whether or not this is an opening. A value left behind is a
      // value some later opening can read: a keyboard menu key arrives as a
      // context event with no press before it, and would otherwise be answered
      // with whatever the last press happened to be pointing at.
      const id = pressedTarget.current;
      pressedTarget.current = null;
      if (!open || id === null) return;
      // Already chosen means already correct — every route selects through the
      // canvas first — and replacing would drop the rest of a multiple
      // selection the gesture was meant to act on.
      if (selectedIds.includes(id)) return;
      select(id, "replace");
    },
    [select, selectedIds]
  );

  return (
    <ContextMenu onOpenChange={opened}>
      <ContextMenuTrigger asChild>
        <div
          style={TRANSPARENT_WRAPPER}
          onPointerDown={noteTarget}
          onContextMenu={noteTarget}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      {/*
        Nothing to act on means nothing to draw. The canvas stops the event
        before it reaches the trigger when the pointer was over the background,
        so this is the other route to the same state: a selection that was
        cleared while the menu's own markup still existed.
      */}
      {selectedId === null ? null : (
        <ContextMenuContent aria-label="Block actions">
          {actions.map(action => (
            <React.Fragment key={action.id}>
              {DESTRUCTIVE.has(action.id) ? <ContextMenuSeparator /> : null}
              <ContextMenuItem
                disabled={!action.enabled}
                // Stacked once there is a reason, so the explanation sits under
                // the verb rather than running on from it.
                className={
                  action.reason === undefined
                    ? undefined
                    : "flex-col items-start gap-0.5"
                }
                onSelect={() => {
                  run[action.id]();
                }}
              >
                <span>{action.label}</span>
                {action.reason === undefined ? null : (
                  // Part of the item's own content, so it is both on screen and
                  // in the name the item is announced by. Nothing here stays
                  // hoverable or focusable once disabled, so an explanation
                  // carried outside the content would reach nobody.
                  <span className="text-xs opacity-80">{action.reason}</span>
                )}
              </ContextMenuItem>
            </React.Fragment>
          ))}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
