"use client";

/**
 * The right-click menu over Layers rows.
 *
 * The row's own verbs first (Rename, hiding on the device being edited, the
 * lock), then the block verbs every other surface offers, from the SAME
 * shared set the inspector's card menu reads, so a verb is offered here
 * exactly when the toolbar and the canvas menu offer it, with the same
 * reason when it may not run.
 *
 * A right-click on a row the selection does not hold selects that row first,
 * as the canvas menu does, so the verbs act on the block the author pointed
 * at rather than on whatever was selected before.
 *
 * Each item names its keystroke, so the menu teaches the keyboard path to
 * the eye and the lock, whose icons are pointer-only.
 *
 * @module layer-row-menu
 */

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { isElement } from "./dom-kind";
import { keyHint } from "./key-hint";
import type { SharedBlockVerbs } from "./keyboard-actions";

/** One of the row's own verbs, as the menu offers it. */
export interface RowMenuItem {
  readonly id: string;
  readonly label: string;
  /** Why it may not run, or `undefined` while it may. */
  readonly reason?: string | undefined;
  /** Its keystroke, in the binding grammar ("mod+shift+h"). */
  readonly keys?: string;
  readonly run: () => void;
}

export interface LayerRowMenuProps {
  /** The block a press on `target` points at, or `null` off the rows. */
  readonly rowOf: (target: EventTarget | null) => string | null;
  /** The selected ids, so a press on a selected row keeps the selection. */
  readonly selectedIds: readonly string[];
  /** Select one block, replacing the selection. */
  readonly select: (id: string) => void;
  /**
   * The row's own verbs, for the selection as it now stands. Asked only
   * while the menu is open: each item's reason is a lock question, and
   * asking on every render of the panel would pay for a menu nobody opened.
   */
  readonly items: () => readonly RowMenuItem[];
  /** The shared block verbs, when the host shares them. */
  readonly verbs: SharedBlockVerbs | undefined;
  /** Whether the reader's keyboard is Apple's, `null` until known. */
  readonly apple: boolean | null;
  readonly children: React.ReactNode;
}

/** The wrapper generates no box, so the panel lays out as it did. */
const TRANSPARENT_WRAPPER: React.CSSProperties = { display: "contents" };

/** One item, held with its reason as visible text when it may not run. */
function Item({
  label,
  reason,
  shortcut,
  onSelect,
}: {
  label: string;
  reason: string | undefined;
  shortcut: string | null;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <ContextMenuItem
      disabled={reason !== undefined}
      className={reason === undefined ? undefined : "flex-wrap"}
      onSelect={onSelect}
    >
      <span>{label}</span>
      {shortcut === null ? null : (
        <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>
      )}
      {reason === undefined || reason === "" ? null : (
        // Part of the item's content: a disabled item takes neither focus nor
        // pointer, so an explanation outside it would reach nobody.
        <span className="nx-layer-menu__reason">{reason}</span>
      )}
    </ContextMenuItem>
  );
}

/** The row's own verbs, read when the menu's content is drawn. */
function OwnItems({
  items,
  hint,
}: {
  items: () => readonly RowMenuItem[];
  hint: (keys: string | undefined) => string | null;
}): React.JSX.Element {
  return (
    <>
      {items().map(item => (
        <Item
          key={item.id}
          label={item.label}
          reason={item.reason}
          shortcut={hint(item.keys)}
          onSelect={item.run}
        />
      ))}
    </>
  );
}

export function LayerRowMenu({
  rowOf,
  selectedIds,
  select,
  items,
  verbs,
  apple,
  children,
}: LayerRowMenuProps): React.JSX.Element {
  // The row the last press aimed at, kept until the menu opens: a touch's
  // long press opens the menu without a context event of its own.
  const pressed = React.useRef<string | null>(null);
  const note = React.useCallback(
    (event: React.SyntheticEvent) => {
      pressed.current = isElement(event.target) ? rowOf(event.target) : null;
    },
    [rowOf]
  );
  const onOpenChange = React.useCallback(
    (next: boolean) => {
      const id = pressed.current;
      pressed.current = null;
      if (!next || id === null || selectedIds.includes(id)) return;
      select(id);
    },
    [select, selectedIds]
  );
  const hint = (keys: string | undefined): string | null =>
    keys === undefined || apple === null ? null : keyHint(keys, apple);
  const shared = verbs?.actions ?? [];
  const deletion = shared.filter(action => action.id === "delete");
  const others = shared.filter(action => action.id !== "delete");
  return (
    // Not modal, as the canvas menu is not: a modal menu marks the editor
    // around it aria-hidden while its controls stay focusable.
    <ContextMenu modal={false} onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          style={TRANSPARENT_WRAPPER}
          onPointerDown={note}
          onContextMenu={event => {
            note(event);
            // Off the rows (the gaps between them) there is nothing to act
            // on, so no menu opens: the trigger's own handler stands down for
            // an event already handled.
            if (pressed.current === null) event.preventDefault();
          }}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Layer actions">
        <OwnItems items={items} hint={hint} />
        {others.length === 0 ? null : <ContextMenuSeparator />}
        {others.map(action => (
          <Item
            key={action.id}
            label={action.label}
            reason={action.enabled ? undefined : (action.reason ?? "")}
            shortcut={null}
            onSelect={() => verbs?.run(action.id)}
          />
        ))}
        {deletion.length === 0 ? null : <ContextMenuSeparator />}
        {deletion.map(action => (
          <Item
            key={action.id}
            label={action.label}
            reason={action.enabled ? undefined : (action.reason ?? "")}
            shortcut={null}
            onSelect={() => verbs?.run(action.id)}
          />
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
