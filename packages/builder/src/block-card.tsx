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
import { layersLockChangeable, type BlockLockStatus } from "./inspector";
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
const CARD_VERBS: readonly ToolbarActionId[] = [
  "duplicate",
  "save-as-shared-style",
  "turn-into-component",
  "detach-component",
  "duplicate-component",
  "delete",
];

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
  /**
   * Why Lock and Unlock are held here, when they are: shown disabled with
   * this reason rather than left out, so the menu says why.
   */
  readonly lockHeld?: string | undefined;
  /** The shared block verbs, when the host supplies them. */
  readonly verbs?: CardVerbs | undefined;
  /** The id the lock reason takes, so held controls can point at it. */
  readonly reasonId?: string | undefined;
}

export function BlockCard({
  icon,
  type,
  name,
  description,
  lock,
  onRename,
  onLock,
  lockHeld,
  verbs,
  reasonId,
}: BlockCardProps): React.JSX.Element {
  const [renaming, setRenaming] = React.useState(false);
  const title = name === "" ? type : name;
  return (
    <div className="nx-block-card" data-block-card="">
      <div className="nx-block-card__head">
        {/* The block's mark on a tile, as the design draws it, so the card
            reads as the block's own header rather than one more row. */}
        <span className="nx-block-card__icon">
          <BlockIconMark icon={icon} size={16} />
        </span>
        <div className="nx-block-card__text">
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
              // Cut short on screen like the description below, so the whole
              // name is in its tooltip for a pointer.
              title={wholeTitle(name, type)}
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
          {/* One line under the name. Cut short on screen, so the whole
              sentence stays in the element, where a screen reader reads it,
              and in its title, for a pointer. */}
          {description === "" ? null : (
            <p className="nx-block-card__description" title={description}>
              {description}
            </p>
          )}
        </div>
        <CardMenu
          title={title}
          locked={lock.layers}
          onRename={
            onRename === undefined ? undefined : () => setRenaming(true)
          }
          onLock={onLock}
          lockHeld={lockHeld}
          verbs={verbs}
        />
      </div>
      <LockLines lock={lock} reasonId={reasonId} />
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
  lockHeld,
  verbs,
}: {
  title: string;
  locked: boolean;
  onRename: (() => void) | undefined;
  onLock: ((locked: boolean) => void) | undefined;
  lockHeld: string | undefined;
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
    // Not modal: a modal menu marks the editor around it aria-hidden while
    // its controls stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
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
          <MenuItem
            label={locked ? "Unlock" : "Lock"}
            reason={lockHeld}
            onSelect={() => onLock(!locked)}
          />
        )}
        <VerbItems offered={offered} verbs={verbs} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The shared block verbs in the card's menu, after a separator. */
function VerbItems({
  offered,
  verbs,
}: {
  offered: CardVerbs["actions"];
  verbs: CardVerbs | undefined;
}): React.JSX.Element | null {
  if (offered.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {offered.map(action => (
        <MenuItem
          key={action.id}
          label={action.label}
          reason={action.enabled ? undefined : (action.reason ?? "")}
          onSelect={() => verbs?.run(action.id)}
        />
      ))}
    </>
  );
}

/**
 * One item of the card's menu, held with its reason when it may not run.
 *
 * The reason is visible text rather than a tooltip, as the context menu does:
 * a disabled menu item takes no pointer and no keyboard focus, so a tooltip
 * there would reach nobody. An empty reason holds the item and says nothing.
 */
function MenuItem({
  label,
  reason,
  onSelect,
}: {
  label: string;
  /** Why it is held, or `undefined` while it may run. */
  reason: string | undefined;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem disabled={reason !== undefined} onSelect={onSelect}>
      {label}
      {reason === undefined || reason === "" ? null : (
        <span className="nx-block-card__reason"> — {reason}</span>
      )}
    </DropdownMenuItem>
  );
}

/** The card's title as one line: the author's name and the type, or the type. */
function wholeTitle(name: string, type: string): string {
  return name === "" ? type : `${name} · ${type}`;
}

/**
 * One line per lock that holds the block, each saying what it fixes and where
 * it is lifted. Words, never a colour or an icon alone.
 */
function LockLines({
  lock,
  reasonId,
}: {
  lock: BlockLockStatus;
  /** The id the reason a held control points at takes. */
  reasonId?: string | undefined;
}): React.JSX.Element | null {
  const inherited = lock.layers ? undefined : lock.inheritedFrom;
  // The reason held controls point at: the Layers lock when it holds, its own
  // or one around it, which holds everything, and otherwise the slot's.
  const layersHold = lock.layers || inherited !== undefined;
  if (!layersHold && lock.slot === undefined) return null;
  const [layersId, slotId] = layersHold
    ? [reasonId, undefined]
    : [undefined, reasonId];
  return (
    <ul className="nx-block-card__status">
      {lock.layers ? <OwnLockLine lock={lock} reasonId={layersId} /> : null}
      {inherited === undefined ? null : (
        <InheritedLockLine holder={inherited} reasonId={layersId} />
      )}
      {lock.slot === undefined ? null : (
        <li data-lock={lock.slot.lock}>
          {/* Its own element, so the sentence a held control points at is
              exactly the reason. */}
          <span id={slotId}>{lock.slot.reason}</span> That block sets it itself,
          so it can&apos;t be unlocked here.
        </li>
      )}
    </ul>
  );
}

/** The line for a block locked in Layers itself, and where it is lifted. */
function OwnLockLine({
  lock,
  reasonId,
}: {
  lock: BlockLockStatus;
  reasonId: string | undefined;
}): React.JSX.Element {
  return (
    <li data-lock="layers">
      <span id={reasonId}>
        <strong>Locked</strong>: it can&apos;t be moved, deleted or edited.
      </span>
      {layersLockChangeable(lock) ? " Unlock it from the block's menu." : null}
    </li>
  );
}

/**
 * The line for a block inside one locked in Layers, which is locked with it:
 * the sentence names the block that holds the lock, where it is lifted.
 */
function InheritedLockLine({
  holder,
  reasonId,
}: {
  holder: string;
  reasonId: string | undefined;
}): React.JSX.Element {
  return (
    <li data-lock="layers-inherited">
      <span id={reasonId}>
        <strong>Locked by {holder}</strong>: this block is inside it, so it
        can&apos;t be moved, deleted or edited.
      </span>{" "}
      Unlock {holder} to change it.
    </li>
  );
}

/**
 * The card for several selected blocks: how many, and a menu with the one
 * control well defined across a set, the lock.
 */
export function SelectionCard({
  count,
  lock,
  unlocking,
  held,
  onLock,
}: {
  count: number;
  /** The lock across the set; `mixed` when some are locked. */
  lock: "locked" | "unlocked" | "mixed";
  /** Whether the menu unlocks rather than locks. */
  unlocking: boolean;
  /** How many of them sit where their own lock can't change here. */
  held: number;
  /** Lock or unlock the blocks it may change; omitted when there are none. */
  onLock: (() => void) | undefined;
}): React.JSX.Element {
  const title = `${count} blocks`;
  const verb = unlocking ? "Unlock" : "Lock";
  return (
    <div className="nx-block-card" data-block-card="many">
      <div className="nx-block-card__head">
        <h2 className="nx-block-card__title">{title}</h2>
        {/* Not modal, as the single block's card menu above. */}
        <DropdownMenu modal={false}>
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
            <MenuItem
              // "the others" only while some can change and some can't.
              label={
                held === 0 || held === count
                  ? `${verb} all`
                  : `${verb} the others`
              }
              reason={onLock === undefined ? SELECTION_LOCK_HELD : undefined}
              onSelect={() => onLock?.()}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SelectionLockLines lock={lock} held={held} count={count} />
    </div>
  );
}

/** Why the selection's lock item is held: no block in it may change its lock. */
const SELECTION_LOCK_HELD = "The area each sits in fixes this.";

/** The selection's lock state, and how many have their lock fixed by an area. */
function SelectionLockLines({
  lock,
  held,
  count,
}: {
  lock: "locked" | "unlocked" | "mixed";
  held: number;
  count: number;
}): React.JSX.Element | null {
  if (lock === "unlocked" && held === 0) return null;
  return (
    <ul className="nx-block-card__status">
      {lock === "unlocked" ? null : (
        <li data-lock={lock}>
          {lock === "locked"
            ? "All of them are locked."
            : "Some of them are locked."}
        </li>
      )}
      {held === 0 ? null : <li data-lock="held">{heldWords(held, count)}</li>}
    </ul>
  );
}

/** The held line, in words that agree with how many it is about. */
function heldWords(held: number, count: number): string {
  if (held === count) {
    return "Each sits in an area that fixes its lock, so none can be locked or unlocked here.";
  }
  return held === 1
    ? "1 of them sits in an area that fixes its lock, so it can't be locked or unlocked here."
    : `${held} of them sit in areas that fix their lock, so they can't be locked or unlocked here.`;
}
