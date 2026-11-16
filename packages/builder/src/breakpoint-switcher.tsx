"use client";

/**
 * The device buttons: which of the site's breakpoints the author is styling.
 *
 * **The chosen device IS the breakpoint being edited.** It is the author's
 * choice and nothing else changes it: opening a panel, or a narrower window,
 * only changes how far the canvas is zoomed to fit. The canvas lays the page
 * out at the device's preview width (`previewWidth` in `canvas-width.ts`), so
 * what the author sees is the layout of the breakpoint they are editing.
 *
 * The base breakpoint is named Desktop. The chosen device shows its exact
 * preview width ("Desktop · 1280px", "Tablet · 991px"), and every device's
 * range is in its accessible name and its tooltip: a rounded number that
 * differs from the real one misleads exactly where an author checks a
 * boundary.
 *
 * **Three buttons at most.** The base and the two widest breakpoints are
 * buttons; the rest are in a menu beside them, its own button rather than part
 * of the radio group. While the device being styled is in the menu, the menu's
 * button shows it. The buttons never change places, so a device is always
 * where the author last found it.
 *
 * **A breakpoint selector, not a device preview.** It says which breakpoint is
 * being styled; it makes no claim that the result matches what a visitor sees
 * on a particular phone or tablet.
 *
 * @module breakpoint-switcher
 */

import {
  BASE_BREAKPOINT,
  type BreakpointId,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import { ChevronDown, Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import * as React from "react";

import { authoredBreakpoints, BASE_DEVICE_LABEL } from "./breakpoints";
import { baseWidth, offeredTiers, previewWidth } from "./canvas-width";
import { radioGroupStep } from "./roving-radios";

/**
 * Props for BreakpointSwitcher.
 * @experimental
 */
export interface BreakpointSwitcherProps {
  /** The site's saved breakpoints, as the canvas is compiled against them. */
  breakpoints: BreakpointSet | undefined;
  /** The breakpoint being edited: one of the site's ids, or the base one. */
  selected: BreakpointId;
  /** A device was chosen. */
  onSelect: (breakpoint: BreakpointId) => void;
  /**
   * Whether the saved breakpoints have been read. Until they have, the
   * buttons are inert: choosing a device against a list that is about to be
   * replaced would style a breakpoint the site may not have.
   */
  status: "loading" | "unavailable" | "ready";
}

/**
 * The glyph for a device, chosen by the width it applies at rather than by
 * its name, which is whatever the site called it.
 */
export function tierIcon(
  bound: number | undefined
): React.ComponentType<{ className?: string }> {
  if (bound === undefined) return Monitor;
  if (bound <= 640) return Smartphone;
  if (bound <= 1024) return Tablet;
  return Laptop;
}

export interface DeviceOption {
  id: BreakpointId;
  label: string;
  /** The width the canvas lays this device out at. */
  preview: number | undefined;
  /** Where the breakpoint applies, as its name and tooltip say it. */
  range: string;
}

/**
 * The devices, base first, then each breakpoint from the widest down. One
 * answer for every surface that names them: these buttons, and Settings' list
 * of the site's breakpoints.
 */
export function deviceOptions(
  breakpoints: BreakpointSet | undefined
): DeviceOption[] {
  const authored = authoredBreakpoints(
    breakpoints ?? { viewport: [], container: [] }
  ).viewport;
  const from = baseWidth(breakpoints);
  return [
    {
      id: BASE_BREAKPOINT,
      label: BASE_DEVICE_LABEL,
      preview: previewWidth(breakpoints, BASE_BREAKPOINT),
      range: from === undefined ? "every width" : `from ${from} pixels`,
    },
    ...offeredTiers(breakpoints).map(tier => ({
      id: tier.id,
      // The label from the definition the compiler kept for this bound, so two
      // rows sharing one bound are named by the one that applies.
      label:
        authored.find(
          def => def.id === tier.id && def.maxWidth === tier.maxWidth
        )?.label ?? tier.id,
      preview: tier.maxWidth,
      range: `up to ${tier.maxWidth} pixels`,
    })),
  ];
}

/**
 * What the switcher calls the device for this tier, or `undefined` for a tier
 * it does not offer (a container tier). Read from the switcher's own list, so
 * a surface naming the device being edited says what the switcher says.
 */
export function deviceLabel(
  breakpoints: BreakpointSet | undefined,
  id: BreakpointId
): string | undefined {
  return deviceOptions(breakpoints).find(option => option.id === id)?.label;
}

/** How many devices are buttons, the base counting as one. */
const BUTTON_COUNT = 3;

/**
 * The house focus ring, off the button by a gap of the bar's surface, so it
 * shows on the chosen device's filled button as well as on the others. Without
 * it the buttons fell back to the browser's own outline.
 */
const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--nx-builder-surface)] focus-visible:outline-none";

/** What a device's label reads: its name and the width it is previewed at. */
function shownLabel(option: DeviceOption): string {
  return option.preview === undefined
    ? option.label
    : `${option.label} · ${option.preview}px`;
}

/** The glyph a device is drawn with. */
function glyphOf(option: DeviceOption): React.ComponentType<{
  className?: string;
}> {
  return tierIcon(option.id === BASE_BREAKPOINT ? undefined : option.preview);
}

/**
 * The devices past the third, in a menu of their own.
 *
 * Its button names the device being styled while that device is one of
 * these, with the same label a chosen button shows; otherwise it is a plain
 * "More devices".
 */
/**
 * How the menu's button reads: plain, or naming the device being styled when
 * that device is in the menu. Its tooltip keeps the device and its range, as
 * the buttons keep theirs, because the label beside the glyph is hidden on a
 * narrow bar.
 */
function moreDevicesTrigger(chosen: DeviceOption | undefined): {
  name: string;
  title: string;
  tone: string;
} {
  if (chosen === undefined) {
    return {
      name: "More devices",
      title: "More devices",
      tone: "text-muted-foreground",
    };
  }
  return {
    name: `More devices, styling ${chosen.label}, ${chosen.range}`,
    title: `${chosen.label}, ${chosen.range}`,
    tone: "bg-accent text-accent-foreground",
  };
}

/** The device being styled, on the menu's button: its glyph and its label. */
function ChosenDevice({ device }: { device: DeviceOption }): React.JSX.Element {
  const Glyph = glyphOf(device);
  return (
    <>
      <Glyph className="size-3.5" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="tabular-nums @max-[1400px]/topbar:hidden"
      >
        {shownLabel(device)}
      </span>
    </>
  );
}

function MoreDevices({
  devices,
  chosen,
  ready,
  onSelect,
}: {
  devices: readonly DeviceOption[];
  chosen: DeviceOption | undefined;
  ready: boolean;
  onSelect: (breakpoint: BreakpointId) => void;
}): React.JSX.Element {
  const trigger = moreDevicesTrigger(chosen);
  /*
   * Held here so a menu already open closes when the saved breakpoints stop
   * being trusted: disabling the trigger alone leaves an open menu choosing
   * against the list the switcher has just declared untrusted.
   */
  const [open, setOpen] = React.useState(false);
  return (
    // Not modal, as the zoom menu: a modal menu hides the focusable editor
    // around it from assistive technology (axe: aria-hidden-focus).
    <DropdownMenu modal={false} open={open && ready} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={!ready}
        aria-label={trigger.name}
        title={trigger.title}
        className={cn(
          "inline-flex h-full items-center gap-1 rounded px-1.5 text-xs disabled:opacity-40",
          FOCUS_RING,
          trigger.tone
        )}
      >
        {chosen === undefined ? null : <ChosenDevice device={chosen} />}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={chosen?.id ?? ""}
          onValueChange={id => {
            if (ready) onSelect(id);
          }}
        >
          {devices.map(device => (
            <DropdownMenuRadioItem
              key={device.id}
              value={device.id}
              aria-label={`${device.label}, ${device.range}`}
            >
              {shownLabel(device)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BreakpointSwitcher({
  breakpoints,
  selected,
  onSelect,
  status,
}: BreakpointSwitcherProps): React.JSX.Element | null {
  const ready = status === "ready";
  const options = React.useMemo(
    () => deviceOptions(breakpoints),
    [breakpoints]
  );
  const radios = React.useRef<Array<HTMLButtonElement | null>>([]);

  // An id the list does not hold is shown as the base, which is where the
  // host sends an edit for a breakpoint the site no longer defines.
  const found = options.findIndex(option => option.id === selected);
  const activeIndex = found >= 0 ? found : 0;
  const active = options[activeIndex];
  const buttons = options.slice(0, BUTTON_COUNT);
  const overflow = options.slice(BUTTON_COUNT);
  // The button styled, or none when the device styled is in the menu: the
  // arrows then start from the first button, which holds the tab stop.
  const buttonIndex = activeIndex < BUTTON_COUNT ? activeIndex : -1;

  const move = (delta: number): void => {
    const from = Math.max(buttonIndex, 0);
    const index = (from + delta + buttons.length) % buttons.length;
    const next = buttons[index];
    if (next === undefined) return;
    radios.current[index]?.focus();
    onSelect(next.id);
  };

  // Desktop alone is not a choice: the control appears once the site has a
  // breakpoint to switch to.
  if (options.length < 2) return null;

  return (
    // The whole switcher one control high, its border and padding inside that
    // height, with the device buttons filling what is left; the scale's own
    // value stands in where the density tokens aren't declared.
    <div className="inline-flex h-[var(--nx-builder-control-height,1.75rem)] items-center gap-0.5 rounded-md border p-0.5">
      <div
        role="radiogroup"
        aria-label="Device"
        className="nx-breakpoint-switcher inline-flex h-full items-center gap-0.5"
        onKeyDown={event => {
          if (!ready) return;
          const step = radioGroupStep(event.key);
          if (step === null) return;
          event.preventDefault();
          move(step);
        }}
      >
        {buttons.map((option, index) => {
          const isSelected = ready && index === buttonIndex;
          const name = `${option.label}, ${option.range}`;
          const Glyph = glyphOf(option);
          return (
            <button
              key={option.id}
              ref={element => {
                radios.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!ready}
              aria-label={name}
              title={
                ready
                  ? name
                  : status === "loading"
                    ? "Available once the site's saved styles have loaded."
                    : "Your site's saved styles could not be read, so the canvas cannot be sized against them."
              }
              tabIndex={index === Math.max(buttonIndex, 0) ? 0 : -1}
              onClick={() => onSelect(option.id)}
              className={cn(
                "inline-flex h-full items-center gap-1 rounded px-2 text-xs",
                FOCUS_RING,
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Glyph className="size-3.5" aria-hidden="true" />
              {/* The chosen device's name and the width it is previewed at; the
                others are told apart by their glyph, name and tooltip. The
                first thing the top bar gives up when it is narrow: the glyph,
                the accessible name and the tooltip still say which it is. */}
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="tabular-nums @max-[1400px]/topbar:hidden"
                >
                  {shownLabel(option)}
                </span>
              ) : null}
            </button>
          );
        })}
        {/* Says which device is being styled when the choice changes, for an
          author who cannot see the buttons. */}
        <span className="sr-only" aria-live="polite">
          {ready && active !== undefined
            ? `Styling ${active.label}${active.preview === undefined ? "" : `, ${active.preview} pixels`}`
            : ""}
        </span>
      </div>
      {overflow.length === 0 ? null : (
        <MoreDevices
          devices={overflow}
          chosen={ready && buttonIndex < 0 ? active : undefined}
          ready={ready}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}
