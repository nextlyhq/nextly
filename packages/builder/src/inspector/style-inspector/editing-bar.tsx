"use client";

/**
 * The "what you're editing" bar at the top of the Style tab.
 *
 * One line of chips says, before any control does, what the next style edit
 * changes: the target ("● This block" in pink, or "◆ <style>" in green), the
 * device the canvas shows, and the state (amber when not Normal). Each chip
 * carries words as well as colour. The device and the state are the canvas's
 * own values, handed down and never a second copy kept here.
 *
 * The line keeps one height whatever the author does to the block: a value
 * changed, a block style or a shared style applied, a font picked. The one
 * thing that adds a line is choosing a shared style as the target, which says
 * how widely it is used and that an edit changes every block wearing it.
 *
 * Escape on a shared target returns to this block, and a switch of target is
 * announced.
 *
 * @module editing-bar
 */

import type { StyleState } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import { Monitor } from "lucide-react";
import * as React from "react";

import { ChromeTooltip } from "../../chrome-tooltip";

import {
  type ApplyOffer,
  type BarOffer,
  type ChipTarget,
  type EditingBarChip,
  TargetChip,
} from "./editing-chips";
import { stateLabel } from "./state-switcher";

export type { ApplyOffer, BarOffer, EditingBarChip } from "./editing-chips";

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

export interface EditingBarProps {
  readonly target: EditTarget;
  /** The shared styles the block wears, in the order that decides which wins. */
  readonly chips?: readonly EditingBarChip[];
  /**
   * Choose the target: a chip's id, or `null` for this block. Absent, the
   * styles are listed but cannot become the target.
   */
  readonly onTargetChange?: (id: string | null) => void;
  /** Take a style off the block. Absent withholds the item. */
  readonly onRemove?: (id: string) => void;
  /** Keep the style's look on this block only. Absent withholds the item. */
  readonly onDetach?: (id: string) => void;
  /**
   * Why one style can't be detached, when its look can't be kept exactly:
   * asked as its menu opens, so the item is held with the reason beside it.
   */
  readonly detachHeld?: (id: string) => string | undefined;
  /** Why Detach and Remove are held (the block's lock), shown in the menu. */
  readonly chipActionsHeld?: string;
  /**
   * Why a shared style can't be made the target (the block's design is held,
   * which its shared styles' values are part of), said on each such item.
   */
  readonly targetHeld?: string;
  /** "Apply a shared style…": the picker it opens, or why it is held. */
  readonly apply: ApplyOffer;
  /** "Save as shared style…": runs, or why it is held. */
  readonly save: BarOffer;
  /** Why a shared target's values can't be changed, when they can't. */
  readonly sharedReadOnly?: string;
  /** The device the canvas shows: "Desktop". */
  readonly device: string;
  /** The devices an edit reaches, in words: "All devices", "Tablet and smaller". */
  readonly deviceReach?: string;
  /** The device's glyph, as the top bar draws it. */
  readonly deviceIcon?: React.ComponentType<{ className?: string }>;
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

/** The line a shared target adds: how far it reaches, and what that means. */
export function sharedUsageLine(reach: string): string {
  // The reach sentence starts a sentence of its own; here it follows a dot.
  const said =
    reach === "" ? "" : reach.charAt(0).toLowerCase() + reach.slice(1);
  return said === ""
    ? "Shared style. Changes here change all of them."
    : `Shared style · ${said}. Changes here change all of them.`;
}

/** The words over the sections while a state other than Normal is edited. */
export function stateLookLine(state: StyleState): string {
  return `You are editing the ${stateLabel(state)} look. Normal stays as it is.`;
}

export function EditingBar({
  target,
  chips = [],
  sharedReadOnly,
  device,
  deviceReach,
  deviceIcon,
  state,
  stateControl,
  // What the target chip's menu offers, handed to it whole.
  ...menu
}: EditingBarProps): React.JSX.Element {
  const announced = useSwitchAnnouncement(target);
  const onTargetChange = menu.onTargetChange;
  return (
    // Its own provider, as each surface keeps one: the device chip says where
    // the device is chosen in the editor's tooltip, wherever the bar is drawn.
    <TooltipProvider delayDuration={300}>
      <section
        className="nx-editing-bar"
        aria-label="What you're editing"
        data-target={target.kind}
        data-state={state}
        onKeyDown={event => leaveOnEscape(event, target, onTargetChange)}
      >
        <div className="nx-editing-bar__line">
          <TargetChip
            {...menu}
            target={chipTarget(target, chips)}
            chips={chips}
          />
          <DeviceChip device={device} reach={deviceReach} icon={deviceIcon} />
          <StateChip state={state} stateControl={stateControl} />
        </div>
        {target.kind === "shared" ? (
          <UsageLine reach={target.reach} readOnly={sharedReadOnly} />
        ) : null}
        <p className="nx-sr-only" role="status">
          {announced}
        </p>
      </section>
    </TooltipProvider>
  );
}

/**
 * Escape on a shared target goes back to this block, so leaving a site-wide
 * edit is one key from anywhere in the bar. A key a menu inside the bar
 * already answered (its own Escape) is left alone, and the one answered here
 * is marked, so the editor's Escape, which skips an answered key, does not
 * also select the parent block.
 */
function leaveOnEscape(
  event: React.KeyboardEvent,
  target: EditTarget,
  onTargetChange: ((id: string | null) => void) | undefined
): void {
  if (event.key !== "Escape" || target.kind !== "shared") return;
  if (onTargetChange === undefined || event.defaultPrevented) return;
  event.preventDefault();
  onTargetChange(null);
}

/** The target as its chip shows it, a worn style's lock included. */
function chipTarget(
  target: EditTarget,
  chips: readonly EditingBarChip[]
): ChipTarget {
  if (target.kind === "block") return target;
  const worn = chips.find(chip => chip.id === target.id);
  return {
    kind: "shared",
    id: target.id,
    name: target.name,
    className: target.className,
    locked: worn?.locked === true,
  };
}

/** A shared target's line under the chips, and why it is read-only, if so. */
function UsageLine({
  reach,
  readOnly,
}: {
  reach: string;
  readOnly: string | undefined;
}): React.JSX.Element {
  return (
    <div className="nx-editing-bar__usage">
      <p data-shared-reach="">{sharedUsageLine(reach)}</p>
      {readOnly === undefined ? null : (
        <p className="nx-editing-bar__note" data-shared-read-only="">
          {readOnly}
        </p>
      )}
    </div>
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
 * The device the canvas shows, with its glyph: a report, not a control. The
 * device is chosen in the top bar, which its tooltip says, with the devices
 * an edit here reaches; a reader hears both after its name.
 */
function DeviceChip({
  device,
  reach,
  icon: Icon = Monitor,
}: {
  device: string;
  reach: string | undefined;
  icon: React.ComponentType<{ className?: string }> | undefined;
}): React.JSX.Element {
  const about = [
    reach === undefined ? undefined : `Changes here reach: ${reach}.`,
    "The device is chosen in the top bar.",
  ]
    .filter(line => line !== undefined)
    .join(" ");
  return (
    <ChromeTooltip content={about}>
      <span className="nx-editing-bar__chip nx-editing-bar__device">
        <Icon className="nx-editing-bar__device-icon" aria-hidden="true" />
        <span data-edit-device="">{device}</span>
        <span className="nx-sr-only">. {about}</span>
      </span>
    </ChromeTooltip>
  );
}

/**
 * The state: the host's State menu drawn as a chip, amber when not Normal, or
 * the state's name when the host cannot carry a choice to its canvas.
 */
function StateChip({
  state,
  stateControl,
}: {
  state: StyleState;
  stateControl: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="nx-editing-bar__state-chip" data-state={state}>
      {stateControl ?? (
        // Said once, by the words below, for a reader.
        <span
          className="nx-editing-bar__chip nx-editing-bar__state"
          aria-hidden="true"
        >
          {stateLabel(state)}
        </span>
      )}
      {/* The state in words for a test or a reader, whichever draws it. */}
      <span className="nx-sr-only" data-edit-state={state}>
        {stateLabel(state)}
      </span>
    </span>
  );
}
