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
import { cn } from "@nextlyhq/ui/utils";
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import * as React from "react";

import { authoredBreakpoints } from "./breakpoints";
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
function tierIcon(
  bound: number | undefined
): React.ComponentType<{ className?: string }> {
  if (bound === undefined) return Monitor;
  if (bound <= 640) return Smartphone;
  if (bound <= 1024) return Tablet;
  return Laptop;
}

interface DeviceOption {
  id: BreakpointId;
  label: string;
  /** The width the canvas lays this device out at. */
  preview: number | undefined;
  /** Where the breakpoint applies, as its name and tooltip say it. */
  range: string;
}

/** The devices, base first, then each breakpoint from the widest down. */
function deviceOptions(breakpoints: BreakpointSet | undefined): DeviceOption[] {
  const authored = authoredBreakpoints(
    breakpoints ?? { viewport: [], container: [] }
  ).viewport;
  const from = baseWidth(breakpoints);
  return [
    {
      id: BASE_BREAKPOINT,
      label: "Desktop",
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

  const move = (delta: number): void => {
    const index = (activeIndex + delta + options.length) % options.length;
    const next = options[index];
    if (next === undefined) return;
    radios.current[index]?.focus();
    onSelect(next.id);
  };

  // Desktop alone is not a choice: the control appears once the site has a
  // breakpoint to switch to.
  if (options.length < 2) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Device"
      className="nx-breakpoint-switcher inline-flex items-center gap-0.5 rounded-md border p-0.5"
      onKeyDown={event => {
        if (!ready) return;
        const step = radioGroupStep(event.key);
        if (step === null) return;
        event.preventDefault();
        move(step);
      }}
    >
      {options.map((option, index) => {
        const isSelected = ready && index === activeIndex;
        const name = `${option.label}, ${option.range}`;
        const Glyph = tierIcon(
          option.id === BASE_BREAKPOINT ? undefined : option.preview
        );
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
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(option.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
              isSelected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground"
            )}
          >
            <Glyph className="size-3.5" aria-hidden="true" />
            {/* The chosen device's name and the width it is previewed at; the
                others are told apart by their glyph, name and tooltip. */}
            {isSelected ? (
              <span aria-hidden="true" className="tabular-nums">
                {option.preview === undefined
                  ? option.label
                  : `${option.label} · ${option.preview}px`}
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
  );
}
