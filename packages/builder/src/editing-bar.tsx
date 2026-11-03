"use client";

/**
 * The "what you're editing" bar at the top of the Style tab.
 *
 * Says in words what the next edit changes before any control does. Line one
 * is the target: "This block", then a chip per shared style the block wears;
 * pressing a chip makes it the target, and the bar then says the style's name,
 * class name and reach. Line two is the device and the state, which are the
 * canvas's own values, handed down and never a second copy kept here: the bar
 * describes what the canvas is showing, whichever target is chosen.
 *
 * The chips are a toggle group: one tab stop, arrow keys between them, Space
 * or Enter to choose, and Escape on a shared target returns to this block.
 * The block is pink and a shared style green, but the words and
 * `aria-pressed` carry the meaning, never the colour alone; a switch is
 * announced.
 *
 * @module editing-bar
 */

import type { StyleState } from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { ChevronDown, Lock, Monitor } from "lucide-react";
import * as React from "react";

import { stateLabel } from "./state-switcher";

/**
 * What a style edit writes to: this block, or one of the shared styles it
 * wears, with what the bar says about it.
 */
export type EditTarget =
  | { readonly kind: "block" }
  | {
      readonly kind: "shared";
      readonly id: string;
      /** The style's name: "Card". */
      readonly name: string;
      /** The class name as developers read it: ".card". */
      readonly className: string;
      /** How far it reaches, in words, or "" while that is not known. */
      readonly reach: string;
    };

/** One shared style the block wears, as its chip shows it. */
export interface EditingBarChip {
  readonly id: string;
  readonly name: string;
  /** Locked: its chip carries a lock mark, named in words. */
  readonly locked?: boolean;
  /** The class the page carries for it, as developers read it: ".nx-c-card". */
  readonly className: string;
}

export interface EditingBarProps {
  readonly target: EditTarget;
  /** The shared styles the block wears, in the order that decides which wins. */
  readonly chips?: readonly EditingBarChip[];
  /**
   * Choose the target: a chip's id, or `null` for this block. Absent, the
   * chips are listed but cannot become the target.
   */
  readonly onTargetChange?: (id: string | null) => void;
  /** Take a style off the block. Absent withholds the item. */
  readonly onRemove?: (id: string) => void;
  /** Keep the style's look on this block only. Absent withholds the item. */
  readonly onDetach?: (id: string) => void;
  /** Why the chip's actions are held (the block's lock), shown in its menu. */
  readonly chipActionsHeld?: string;
  /** What line one offers after the chips: apply or save a shared style. */
  readonly actions?: React.ReactNode;
  /** Why a shared target's values can't be changed, when they can't. */
  readonly sharedReadOnly?: string;
  /** The device being edited, by name: "Desktop", "Tablet". */
  readonly device: string;
  /** The breakpoint tier the edit is stored under, as the site names it: "base". */
  readonly tier?: string;
  /** The state being edited. */
  readonly state: StyleState;
  /**
   * The control that changes the state, when the host can carry the choice to
   * its canvas. Without it the bar names the state and offers no change.
   */
  readonly stateControl?: React.ReactNode;
}

/** The sentence a switch of target is announced with. */
function targetAnnouncement(target: EditTarget): string {
  return target.kind === "block"
    ? "Now editing this block"
    : `Now editing shared style ${target.name}`;
}

export function EditingBar({
  target,
  chips = [],
  onTargetChange,
  onRemove,
  onDetach,
  chipActionsHeld,
  actions,
  sharedReadOnly,
  device,
  tier,
  state,
  stateControl,
}: EditingBarProps): React.JSX.Element {
  const announced = useSwitchAnnouncement(target);
  const activeId = target.kind === "shared" ? target.id : null;
  const group = React.useRef<HTMLDivElement>(null);
  const labelId = React.useId();
  return (
    <section
      className="nx-editing-bar"
      aria-label="What you're editing"
      data-target={target.kind}
      onKeyDown={event => {
        // Escape on a shared target goes back to this block, so leaving a
        // site-wide edit is one key from anywhere in the bar.
        if (event.key !== "Escape" || activeId === null) return;
        // A key a menu inside the bar already answered (its own Escape) is
        // left alone, and the one answered here is marked, so the editor's
        // Escape, which skips an answered key, does not also select the
        // parent block.
        if (onTargetChange === undefined || event.defaultPrevented) return;
        event.preventDefault();
        onTargetChange(null);
        focusChip(group.current, null);
      }}
    >
      <div className="nx-editing-bar__line">
        <span className="nx-editing-bar__label" id={labelId}>
          Editing
        </span>
        <div
          ref={group}
          className="nx-editing-bar__targets"
          role="group"
          aria-labelledby={labelId}
          onKeyDown={event => moveBetweenChips(event, group.current)}
        >
          <TargetChip
            id={null}
            name="This block"
            tone="local"
            active={activeId === null}
            onSelect={onTargetChange}
          />
          {chips.map(chip => (
            <span key={chip.id} className="nx-editing-bar__chip-wrap">
              <TargetChip
                id={chip.id}
                name={chip.name}
                className={chip.className}
                locked={chip.locked === true}
                tone="shared"
                active={activeId === chip.id}
                onSelect={onTargetChange}
              />
              <ChipMenu
                chip={chip}
                onRemove={onRemove}
                onDetach={onDetach}
                held={chipActionsHeld}
              />
            </span>
          ))}
        </div>
        {actions}
      </div>
      {target.kind === "shared" ? (
        <SharedBanner
          target={target}
          readOnly={sharedReadOnly}
          onLeave={
            onTargetChange === undefined
              ? undefined
              : () => {
                  onTargetChange(null);
                  focusChip(group.current, null);
                }
          }
        />
      ) : null}
      <BarContext
        device={device}
        tier={tier}
        state={state}
        stateControl={stateControl}
      />
      <p className="nx-sr-only" role="status">
        {announced}
      </p>
    </section>
  );
}

/**
 * The announcement for a switch of target: empty on mount and when a new
 * block is selected (nothing was switched), the sentence after a switch.
 */
function useSwitchAnnouncement(target: EditTarget): string {
  const key = target.kind === "block" ? "" : target.id;
  const seen = React.useRef(key);
  const [said, setSaid] = React.useState("");
  React.useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    setSaid(targetAnnouncement(target));
  }, [key, target]);
  return said;
}

/**
 * The bar's second line: the device, the breakpoint tier and the state, from
 * the canvas, with the State menu when the host can act on a choice.
 */
function BarContext({
  device,
  tier,
  state,
  stateControl,
}: Pick<
  EditingBarProps,
  "device" | "tier" | "state" | "stateControl"
>): React.JSX.Element {
  return (
    <div className="nx-editing-bar__context">
      <Monitor aria-hidden="true" size={14} />
      <span data-edit-device="">{device}</span>
      {tier === undefined ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span data-edit-tier="">{tier}</span>
        </>
      )}
      <span aria-hidden="true">·</span>
      <span className="nx-editing-bar__state-label" aria-hidden="true">
        State
      </span>
      {stateControl ?? (
        <span className="nx-editing-bar__state" data-edit-state={state}>
          {stateLabel(state)}
        </span>
      )}
      {stateControl === undefined ? null : (
        // Named for the reader as well when the control draws it, so the
        // bar always says the state in words.
        <span className="nx-sr-only" data-edit-state={state}>
          {stateLabel(state)}
        </span>
      )}
    </div>
  );
}

/** The chip buttons of a group, in order. */
function chipButtons(group: HTMLElement | null): HTMLButtonElement[] {
  return group === null
    ? []
    : [...group.querySelectorAll<HTMLButtonElement>("[data-target-chip]")];
}

/** Focus the chip for a target: a style's id, or this block for `null`. */
function focusChip(group: HTMLElement | null, id: string | null): void {
  const want = id ?? "";
  chipButtons(group)
    .find(button => button.dataset.targetChip === want)
    ?.focus();
}

/** Arrow keys, Home and End move focus between the chips, wrapping. */
function moveBetweenChips(
  event: React.KeyboardEvent<HTMLDivElement>,
  group: HTMLElement | null
): void {
  const buttons = chipButtons(group);
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (at === -1) return;
  const step: Record<string, number | undefined> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
  };
  let next: number | undefined;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else if (step[event.key] !== undefined) {
    next = (at + (step[event.key] ?? 0) + buttons.length) % buttons.length;
  }
  if (next === undefined) return;
  event.preventDefault();
  buttons[next]?.focus();
}

/** One target in the group: pressed when it is the target. */
function TargetChip({
  id,
  name,
  className,
  locked = false,
  tone,
  active,
  onSelect,
}: {
  id: string | null;
  name: string;
  /** A shared style's class name, named in its tooltip. */
  className?: string;
  /** A locked style's chip carries a lock, named ", locked" for a reader. */
  locked?: boolean;
  tone: "local" | "shared";
  active: boolean;
  onSelect: ((id: string | null) => void) | undefined;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="nx-editing-bar__chip"
      data-tone={tone}
      data-target-chip={id ?? ""}
      // The active target alone names the target for a test or a reader
      // looking for it, whichever chip it is.
      data-edit-target={active ? (id === null ? "block" : "shared") : undefined}
      aria-pressed={active}
      // One tab stop for the group: the target. The arrows reach the rest.
      tabIndex={active ? 0 : -1}
      disabled={onSelect === undefined && !active}
      title={
        id === null
          ? "Edit this block only"
          : `Edit shared style ${name}, ${className ?? ""}`
      }
      onClick={() => {
        if (!active) onSelect?.(id);
      }}
    >
      {name}
      {locked ? (
        <>
          <Lock aria-hidden="true" size={11} />
          <span className="nx-sr-only">, locked</span>
        </>
      ) : null}
    </button>
  );
}

/** A shared style chip's menu: Detach and Remove, or why they are held. */
function ChipMenu({
  chip,
  onRemove,
  onDetach,
  held,
}: {
  chip: EditingBarChip;
  onRemove: ((id: string) => void) | undefined;
  onDetach: ((id: string) => void) | undefined;
  held: string | undefined;
}): React.JSX.Element | null {
  if (onRemove === undefined && onDetach === undefined) return null;
  return (
    // Not modal, as the block card's menu is not: a modal menu hides the
    // editor around it while its controls stay focusable.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-editing-bar__chip-menu"
          data-tone="shared"
          aria-label={`Actions for shared style ${chip.name}`}
        >
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenuTrigger>
      {/* Kept clear of the window's edge. */}
      <DropdownMenuContent align="start" collisionPadding={8}>
        {onDetach === undefined ? null : (
          <DropdownMenuItem
            disabled={held !== undefined}
            onSelect={() => onDetach(chip.id)}
          >
            Detach: keep the look on this block only
            {held === undefined ? null : (
              <span className="nx-block-card__reason"> — {held}</span>
            )}
          </DropdownMenuItem>
        )}
        {onRemove === undefined ? null : (
          <DropdownMenuItem
            disabled={held !== undefined}
            onSelect={() => onRemove(chip.id)}
          >
            {`Remove ${chip.name} from this block`}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The line a shared target adds: its name, class name and reach. */
function SharedBanner({
  target,
  readOnly,
  onLeave,
}: {
  target: Extract<EditTarget, { kind: "shared" }>;
  readOnly: string | undefined;
  onLeave: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <div className="nx-editing-bar__banner">
      <p>
        Editing shared style <strong>{target.name}</strong>
        {" · "}
        <code>{target.className}</code>
        {target.reach === "" ? null : (
          <>
            {" · "}
            <span data-shared-reach="">{target.reach}</span>
          </>
        )}
        {onLeave === undefined ? null : (
          <>
            {" · "}
            <button
              type="button"
              className="nx-editing-bar__leave"
              onClick={onLeave}
            >
              Edit this block only
            </button>
          </>
        )}
      </p>
      {readOnly === undefined ? null : (
        <p className="nx-editing-bar__note" data-shared-read-only="">
          {readOnly}
        </p>
      )}
    </div>
  );
}
