"use client";

/**
 * The top of the inspector: which block this is, before anything it holds.
 *
 * Its icon, its type and the author's own label for it, a one-line description
 * from its definition, and a line for each lock that holds it. Rename, Lock or
 * Unlock and the block verbs sit in one "⋯" menu, so housekeeping never takes
 * the place at the top of the panel that says what is selected.
 *
 * **Rename** is in the menu and on a double-click of the title. The label is
 * stored on the node as `name` and shown in Layers and here; visitors never
 * see it. One rename is one entry in the history.
 *
 * **Two kinds of lock, said apart.** The block's own Layers lock is an edit of
 * the page, so the menu offers Unlock to anyone editing it. A lock set by the
 * block this one sits in is the containing block's own rule, written in code,
 * so the card says what it fixes and who sets it, and offers no Unlock.
 *
 * @module block-card
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@nextlyhq/ui";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import type { BlockLockStatus } from "./inspector";
import type { SharedBlockVerbs } from "./keyboard-actions";
import type { ToolbarActionId } from "./toolbar-actions";

/**
 * The block verbs the card's menu runs, handed in by the host: the SAME verbs
 * and verdicts the toolbar, the context menu and the palette use, rather than
 * a second implementation here. A menu that decided for itself whether Delete
 * was allowed is how one surface comes to offer a verb another refuses.
 */
export type CardVerbs = SharedBlockVerbs;

/** The verbs from the shared set that the card's menu offers, in order. */
const CARD_VERBS: readonly ToolbarActionId[] = ["duplicate", "delete"];

export interface BlockCardProps {
  /** The block's icon concept, if it names one. */
  readonly icon: string | undefined;
  /** What the block is: "Heading", "Image". */
  readonly type: string;
  /** The author's own label for this block, empty when there is none. */
  readonly name: string;
  /** One line about the block, from its definition. */
  readonly description: string;
  /** Which locks hold it. */
  readonly lock: BlockLockStatus;
  /** Store a new label, or remove it with an empty one. Omitted withholds Rename. */
  readonly onRename?: ((name: string) => void) | undefined;
  /** Set or lift the Layers lock. Omitted withholds Lock and Unlock. */
  readonly onLock?: ((locked: boolean) => void) | undefined;
  /** The shared block verbs, when the host supplies them. */
  readonly verbs?: CardVerbs | undefined;
}

export function BlockCard({
  icon,
  type,
  name,
  description,
  lock,
  onRename,
  onLock,
  verbs,
}: BlockCardProps): React.JSX.Element {
  const [renaming, setRenaming] = React.useState(false);
  const title = name === "" ? type : name;
  return (
    <div className="nx-block-card" data-block-card="">
      <div className="nx-block-card__head">
        <BlockIconMark icon={icon} size={16} />
        {renaming && onRename !== undefined ? (
          <RenameField
            name={name}
            onDone={next => {
              setRenaming(false);
              if (next !== undefined && next !== name) onRename(next);
            }}
          />
        ) : (
          <h2
            className="nx-block-card__title"
            onDoubleClick={
              onRename === undefined ? undefined : () => setRenaming(true)
            }
          >
            {name === "" ? (
              type
            ) : (
              <>
                {name}
                <span className="nx-block-card__type"> · {type}</span>
              </>
            )}
          </h2>
        )}
        <CardMenu
          title={title}
          locked={lock.layers}
          onRename={
            onRename === undefined ? undefined : () => setRenaming(true)
          }
          onLock={onLock}
          verbs={verbs}
        />
      </div>
      {description === "" ? null : (
        <p className="nx-block-card__description">{description}</p>
      )}
      <LockLines lock={lock} />
    </div>
  );
}

/**
 * The label field, in place of the title while renaming.
 *
 * Committed on Enter and on blur, and dropped on Escape. `onDone` answers the
 * new label, or `undefined` when the author backed out.
 */
function RenameField({
  name,
  onDone,
}: {
  name: string;
  onDone: (next: string | undefined) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(name);
  const id = React.useId();
  const hintId = `${id}-hint`;
  // Escape blurs the field on its way out; without this the blur would then
  // commit the draft the author just backed out of.
  const cancelled = React.useRef(false);
  return (
    <div className="nx-block-card__rename">
      <label className="nx-sr-only" htmlFor={id}>
        Label
      </label>
      <Input
        id={id}
        value={draft}
        autoFocus
        placeholder="Label"
        aria-describedby={hintId}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => onDone(cancelled.current ? undefined : draft.trim())}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
      <p id={hintId} className="nx-block-card__hint">
        Shown in Layers. Visitors never see it.
      </p>
    </div>
  );
}

/** The card's "⋯" menu: Rename, Lock or Unlock, then the shared block verbs. */
function CardMenu({
  title,
  locked,
  onRename,
  onLock,
  verbs,
}: {
  title: string;
  locked: boolean;
  onRename: (() => void) | undefined;
  onLock: ((locked: boolean) => void) | undefined;
  verbs: CardVerbs | undefined;
}): React.JSX.Element | null {
  const offered = (verbs?.actions ?? []).filter(action =>
    CARD_VERBS.includes(action.id)
  );
  /* Set when Rename is chosen, and acted on once the menu has closed. */
  const renameNext = React.useRef(false);
  if (onRename === undefined && onLock === undefined && offered.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-block-card__menu"
          aria-label={`Actions for ${title}`}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={event => {
          if (!renameNext.current) return;
          renameNext.current = false;
          // Opened only now, once the menu has gone: a field mounted while it
          // was closing lost its focus to the trigger the menu hands focus
          // back to, and its blur ended the rename as it began.
          event.preventDefault();
          onRename?.();
        }}
      >
        {onRename === undefined ? null : (
          <DropdownMenuItem
            onSelect={() => {
              renameNext.current = true;
            }}
          >
            Rename
          </DropdownMenuItem>
        )}
        {onLock === undefined ? null : (
          <DropdownMenuItem onSelect={() => onLock(!locked)}>
            {locked ? "Unlock" : "Lock"}
          </DropdownMenuItem>
        )}
        {offered.length === 0 ? null : <DropdownMenuSeparator />}
        {offered.map(action => (
          <DropdownMenuItem
            key={action.id}
            disabled={!action.enabled}
            onSelect={() => verbs?.run(action.id)}
          >
            {action.label}
            {/*
              Visible text rather than a tooltip, as the context menu does: a
              disabled menu item takes no pointer and no keyboard focus, so a
              tooltip there would reach nobody.
            */}
            {action.reason === undefined ? null : (
              <span className="nx-block-card__reason"> — {action.reason}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What each slot lock fixes, in an author's words. */
const SLOT_LOCK_WORDS = {
  all: "fixes which blocks it holds and their order, so this one can't be moved or removed",
  insert:
    "fixes which blocks it holds, so this one can't be removed or moved out",
  contentOnly:
    "fixes the design of the blocks it holds, so only this block's content can change",
} as const;

/**
 * One line per lock that holds the block, each saying what it fixes and where
 * it is lifted. Words, never a colour or an icon alone.
 */
function LockLines({
  lock,
}: {
  lock: BlockLockStatus;
}): React.JSX.Element | null {
  if (!lock.layers && lock.slot === undefined) return null;
  return (
    <ul className="nx-block-card__status">
      {lock.layers ? (
        <li data-lock="layers">
          <strong>Locked</strong>: it can&apos;t be moved, deleted or edited.
          Unlock it from the menu.
        </li>
      ) : null}
      {lock.slot === undefined ? null : (
        <li data-lock={lock.slot.lock}>
          {lock.slot.holder} {SLOT_LOCK_WORDS[lock.slot.lock]}. That block sets
          it itself, so it can&apos;t be unlocked here.
        </li>
      )}
    </ul>
  );
}

/**
 * The card for several selected blocks: how many, and a menu with the one
 * control well defined across a set, the lock.
 */
export function SelectionCard({
  count,
  lock,
  onLock,
}: {
  count: number;
  /** The lock across the set; `mixed` when some are locked. */
  lock: "locked" | "unlocked" | "mixed";
  /** Lock the set, or unlock it when every block is locked. Omitted withholds the menu. */
  onLock: (() => void) | undefined;
}): React.JSX.Element {
  const title = `${count} blocks`;
  return (
    <div className="nx-block-card" data-block-card="many">
      <div className="nx-block-card__head">
        <h2 className="nx-block-card__title">{title}</h2>
        {onLock === undefined ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="nx-block-card__menu"
                aria-label={`Actions for ${title}`}
              >
                <span aria-hidden="true">⋯</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onLock}>
                {lock === "locked" ? "Unlock all" : "Lock all"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {lock === "unlocked" ? null : (
        <ul className="nx-block-card__status">
          <li data-lock={lock}>
            {lock === "locked"
              ? "All of them are locked."
              : "Some of them are locked."}
          </li>
        </ul>
      )}
    </div>
  );
}
