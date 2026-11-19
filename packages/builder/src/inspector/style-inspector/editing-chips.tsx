"use client";

/**
 * The editing bar's target chip and its menu.
 *
 * The chip says what the next style edit changes: "● This block" in pink, or
 * "◆ <style>" in green while a shared style the block wears is the target. It
 * opens one menu that never changes shape: "This block", each shared style
 * the block wears with Detach and Remove under it, then "Apply a shared
 * style…" and "Save as shared style…". An edit only enables or holds an item;
 * a held item stays where it is with its reason under it, so nothing in the
 * menu, or in the panel below the bar, moves after the first edit.
 *
 * The colour is never the only sign: the mark, the words and the chip's name
 * all say which target it is.
 *
 * @module editing-chips
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@nextlyhq/ui";
import { Check, ChevronDown, Lock } from "lucide-react";
import * as React from "react";

/** One shared style the block wears, as the target menu lists it. */
export interface EditingBarChip {
  readonly id: string;
  readonly name: string;
  /** Locked: its item carries a lock mark, named in words. */
  readonly locked?: boolean;
  /** The class the page carries for it, as developers read it: ".nx-c-card". */
  readonly className: string;
  /**
   * What choosing it does, in words, when that is worth saying: a block
   * style's "Edit Outline for every button that uses it". The class name
   * otherwise.
   */
  readonly hint?: string;
}

/** An action the menu always lists: runs, or is held with its reason. */
export type BarOffer =
  | { readonly run: () => void; readonly held?: undefined }
  | { readonly run?: undefined; readonly held: string };

/** "Apply a shared style…": the picker it opens, or why it is held. */
export type ApplyOffer =
  | {
      /** The picker, drawn under the chip; `close` puts it away. */
      readonly picker: (close: () => void) => React.ReactNode;
      readonly held?: undefined;
    }
  | { readonly picker?: undefined; readonly held: string };

/** What the chip shows for the target. */
export type ChipTarget =
  | { readonly kind: "block" }
  | {
      readonly kind: "shared";
      readonly id: string;
      readonly name: string;
      readonly className: string;
      readonly locked: boolean;
    };

export interface TargetChipProps {
  readonly target: ChipTarget;
  readonly chips: readonly EditingBarChip[];
  /** Choose the target: a style's id, or `null` for this block. */
  readonly onTargetChange?: ((id: string | null) => void) | undefined;
  readonly onRemove?: ((id: string) => void) | undefined;
  readonly onDetach?: ((id: string) => void) | undefined;
  /** Why one style can't be detached: asked only while the menu is open. */
  readonly detachHeld?: ((id: string) => string | undefined) | undefined;
  /** Why Detach and Remove are held (the block's lock). */
  readonly chipActionsHeld?: string | undefined;
  /** Why a shared style can't be made the target (the block's design is held). */
  readonly targetHeld?: string | undefined;
  /** "Apply a shared style…": the picker it opens, or why it is held. */
  readonly apply: ApplyOffer;
  /** "Save as shared style…": runs, or why it is held. */
  readonly save: BarOffer;
}

/** Why a shared style can't be chosen when nothing can carry the choice. */
const NO_SHARED_TARGET = "Shared styles can't be edited from here.";

/** The chip's name for a reader: what is being edited, in words. */
function targetChipName(target: ChipTarget): string {
  if (target.kind === "block") return "Editing: This block";
  const locked = target.locked ? ", locked" : "";
  return `Editing: shared style ${target.name}${locked}`;
}

export function TargetChip({
  target,
  chips,
  onTargetChange,
  onRemove,
  onDetach,
  detachHeld,
  chipActionsHeld,
  targetHeld,
  apply,
  save,
}: TargetChipProps): React.JSX.Element {
  const chip = React.useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = React.useState(false);
  // Set by "Apply a shared style…" and read as the menu hands focus back:
  // the picker opens only then, so the menu's return of focus to the chip
  // cannot take it from the picker's search field.
  const pickNext = React.useRef(false);
  const shared = target.kind === "shared";
  const name = shared ? target.name : "This block";
  return (
    <Popover open={picking} onOpenChange={setPicking} modal>
      <DropdownMenu modal={false}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <button
              ref={chip}
              type="button"
              className="nx-editing-bar__chip nx-editing-bar__target"
              data-tone={shared ? "shared" : "block"}
              data-edit-target={target.kind}
              aria-label={targetChipName(target)}
              // The whole name, for a long one the chip ends in an ellipsis.
              title={
                shared
                  ? `Shared style ${target.name}, ${target.className}`
                  : "This block only"
              }
            >
              <span className="nx-editing-bar__mark" aria-hidden="true">
                {shared ? "◆" : "●"}
              </span>
              <span className="nx-editing-bar__name">{name}</span>
              {shared && target.locked ? (
                <Lock aria-hidden="true" size={11} />
              ) : null}
              <ChevronDown aria-hidden="true" size={12} />
            </button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        {/* Kept clear of the window's edge. */}
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className="nx-editing-bar__menu"
          onCloseAutoFocus={event => {
            if (!pickNext.current) return;
            pickNext.current = false;
            event.preventDefault();
            setPicking(true);
          }}
        >
          <TargetItem
            mark="●"
            tone="block"
            label="This block"
            hint="Changes this block only"
            checked={!shared}
            onSelect={() => onTargetChange?.(null)}
          />
          {chips.map(each => (
            <SharedItems
              key={each.id}
              chip={each}
              checked={shared && target.id === each.id}
              held={
                onTargetChange === undefined
                  ? NO_SHARED_TARGET
                  : shared && target.id === each.id
                    ? undefined
                    : targetHeld
              }
              onChoose={() => onTargetChange?.(each.id)}
              onRemove={onRemove}
              onDetach={onDetach}
              detachHeld={detachHeld}
              actionsHeld={chipActionsHeld}
            />
          ))}
          <DropdownMenuSeparator />
          <OfferItem
            label="Apply a shared style…"
            offer={apply}
            onSelect={() => {
              pickNext.current = true;
            }}
          />
          <OfferItem
            label="Save as shared style…"
            offer={save}
            onSelect={() => save.run?.()}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {apply.picker === undefined ? null : (
        <PopoverContent
          side="bottom"
          align="start"
          // Kept clear of the window's edge.
          collisionPadding={8}
          className="nx-vars-editor nx-shared-style-picker"
          aria-label="Apply a shared style"
          // Back to the chip that opened it: the picker has no trigger of
          // its own for the popover to return focus to.
          onCloseAutoFocus={event => {
            event.preventDefault();
            chip.current?.focus();
          }}
        >
          {apply.picker(() => setPicking(false))}
        </PopoverContent>
      )}
    </Popover>
  );
}

/** An item's words: its label, and a line under it (a hint or a reason). */
function ItemWords({
  label,
  line,
  reason,
}: {
  label: React.ReactNode;
  line: string | undefined;
  /** Whether the line is why the item is held, read as one sentence. */
  reason: boolean;
}): React.JSX.Element {
  return (
    <span className="nx-editing-bar__item-words">
      <span>{label}</span>
      {line === undefined || line === "" ? null : (
        <span
          className={
            reason ? "nx-editing-bar__item-reason" : "nx-editing-bar__item-hint"
          }
        >
          {/* Heard as one sentence; read as a line of its own. */}
          <span className="nx-sr-only"> — </span>
          {line}
        </span>
      )}
    </span>
  );
}

/** A target in the menu: one of a set, the chosen one ticked. */
function TargetItem({
  mark,
  tone,
  label,
  hint,
  checked,
  held,
  locked = false,
  onSelect,
}: {
  mark: string;
  tone: "block" | "shared";
  label: string;
  hint: string | undefined;
  checked: boolean;
  held?: string | undefined;
  locked?: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      // One target of several, as the State menu's items are: a radio item,
      // its choice ticked.
      role="menuitemradio"
      aria-checked={checked}
      disabled={held !== undefined}
      data-target-item={tone}
      onSelect={() => {
        if (!checked) onSelect();
      }}
    >
      <span className="nx-state-menu__tick" aria-hidden="true">
        {checked ? <Check size={12} /> : null}
      </span>
      <ItemWords
        label={
          <span className="nx-editing-bar__item-target" data-tone={tone}>
            <span aria-hidden="true">{mark}</span> {label}
            {locked ? (
              <>
                <Lock aria-hidden="true" size={11} />
                <span className="nx-sr-only">, locked</span>
              </>
            ) : null}
          </span>
        }
        line={held ?? hint}
        reason={held !== undefined}
      />
    </DropdownMenuItem>
  );
}

/** A worn shared style: its target item, then its Detach and Remove. */
function SharedItems({
  chip,
  checked,
  held,
  onChoose,
  onRemove,
  onDetach,
  detachHeld,
  actionsHeld,
}: {
  chip: EditingBarChip;
  checked: boolean;
  held: string | undefined;
  onChoose: () => void;
  onRemove: ((id: string) => void) | undefined;
  onDetach: ((id: string) => void) | undefined;
  detachHeld: ((id: string) => string | undefined) | undefined;
  actionsHeld: string | undefined;
}): React.JSX.Element {
  // Asked while drawing the open menu only: answering plans the detach,
  // which the bar's every render need not pay for.
  const detachReason =
    onDetach === undefined ? undefined : (actionsHeld ?? detachHeld?.(chip.id));
  return (
    <>
      <TargetItem
        mark="◆"
        tone="shared"
        label={chip.name}
        hint={chip.hint ?? chip.className}
        checked={checked}
        held={held}
        locked={chip.locked === true}
        onSelect={onChoose}
      />
      {onDetach === undefined ? null : (
        <DropdownMenuItem
          className="nx-editing-bar__item-sub"
          disabled={detachReason !== undefined}
          onSelect={() => onDetach(chip.id)}
        >
          <ItemWords
            label={
              <>
                Detach<span className="nx-sr-only"> {chip.name}</span>
              </>
            }
            line={detachReason ?? "Keep the look on this block only"}
            reason={detachReason !== undefined}
          />
        </DropdownMenuItem>
      )}
      {onRemove === undefined ? null : (
        <DropdownMenuItem
          className="nx-editing-bar__item-sub"
          disabled={actionsHeld !== undefined}
          onSelect={() => onRemove(chip.id)}
        >
          <ItemWords
            label={
              <>
                Remove<span className="nx-sr-only"> {chip.name}</span>
              </>
            }
            line={actionsHeld ?? `Take ${chip.name} off this block`}
            reason={actionsHeld !== undefined}
          />
        </DropdownMenuItem>
      )}
    </>
  );
}

/** "Apply a shared style…" or "Save as shared style…": always listed. */
function OfferItem({
  label,
  offer,
  onSelect,
}: {
  label: string;
  offer: { readonly held?: string | undefined };
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      disabled={offer.held !== undefined}
      onSelect={onSelect}
      data-bar-offer={label}
    >
      <span className="nx-state-menu__tick" aria-hidden="true" />
      <ItemWords label={label} line={offer.held} reason />
    </DropdownMenuItem>
  );
}
