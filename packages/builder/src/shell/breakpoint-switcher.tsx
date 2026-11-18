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
 * The base breakpoint is named Desktop. Each device is an icon whose
 * accessible name and tooltip give its name, its exact preview width and the
 * widths it styles ("Desktop · 1280px · styles for 1024px and wider"), and
 * the width being styled is always shown as text beside the buttons
 * ("1280px"): a rounded number that differs from the real one misleads
 * exactly where an author checks a boundary.
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

import { authoredBreakpoints, BASE_DEVICE_LABEL } from "../breakpoints";
import { PreviewWidthText } from "../canvas/canvas-preview-width-field";
import {
  baseWidth,
  offeredTiers,
  previewWidth,
  previewWidthRange,
} from "../canvas/canvas-width";
import { ChromeTooltip } from "../chrome-tooltip";
import { radioGroupStep } from "../roving-radios";

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
  /**
   * The width the canvas previews in place of the chosen device's own, or
   * `null` at the device's own. Shown in the warning colour with "Reset"
   * beside it; the device chosen stays the one every edit goes to.
   */
  previewWidth?: number | null;
  /**
   * Where a typed width and Reset go, `null` for the device's own. Given, the
   * width beside the buttons is a button that swaps in a field to type one;
   * left out, it is text.
   */
  onPreviewWidth?: (width: number | null) => void;
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
  /** Where the breakpoint applies, in words, as Settings lists it. */
  range: string;
  /**
   * The same widths as the device's control says them, after "styles for":
   * "1024px and wider", "991px and narrower". From the same bound as
   * {@link DeviceOption.range}, so the two cannot disagree.
   */
  stylesFor: string;
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
      stylesFor: from === undefined ? "every width" : `${from}px and wider`,
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
      stylesFor: `${tier.maxWidth}px and narrower`,
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

/** What a device's menu item reads: its name and the width it is previewed at. */
function shownLabel(option: DeviceOption): string {
  return option.preview === undefined
    ? option.label
    : `${option.label} · ${option.preview}px`;
}

/**
 * A device's accessible name and tooltip: its name, its preview width and the
 * widths it styles, "Desktop · 1280px · styles for 1024px and wider".
 */
function deviceName(option: DeviceOption): string {
  return `${shownLabel(option)} · styles for ${option.stylesFor}`;
}

/** Why the devices cannot be chosen yet, for a gate that is not open. */
function notReadyReason(status: BreakpointSwitcherProps["status"]): string {
  return status === "loading"
    ? "Available once the site's saved styles have loaded."
    : "Your site's saved styles could not be read, so the canvas cannot be sized against them.";
}

/** The glyph a device is drawn with. */
function glyphOf(option: DeviceOption): React.ComponentType<{
  className?: string;
}> {
  return tierIcon(option.id === BASE_BREAKPOINT ? undefined : option.preview);
}

/** A device's glyph, decoration beside the name its control carries. */
function DeviceGlyph({ device }: { device: DeviceOption }): React.JSX.Element {
  const Glyph = glyphOf(device);
  return <Glyph className="size-3.5" aria-hidden="true" />;
}

/**
 * One device's radio button: its glyph, named and tooltipped with its name,
 * width and range. Until the saved breakpoints are read it is inert, and the
 * browser's own tooltip says why, since a disabled control opens no other.
 */
function DeviceButton({
  option,
  isSelected,
  ready,
  status,
  inTabOrder,
  buttonRef,
  onSelect,
}: {
  option: DeviceOption;
  isSelected: boolean;
  ready: boolean;
  status: BreakpointSwitcherProps["status"];
  inTabOrder: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: (breakpoint: BreakpointId) => void;
}): React.JSX.Element {
  const name = deviceName(option);
  return (
    <ChromeTooltip content={name} disabled={!ready}>
      <button
        ref={buttonRef}
        type="button"
        role="radio"
        aria-checked={isSelected}
        disabled={!ready}
        aria-label={name}
        {...(ready ? {} : { title: notReadyReason(status) })}
        tabIndex={inTabOrder ? 0 : -1}
        onClick={() => onSelect(option.id)}
        className={cn(
          "inline-flex h-full items-center rounded px-2 text-xs",
          FOCUS_RING,
          isSelected
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground"
        )}
      >
        <DeviceGlyph device={option} />
      </button>
    </ChromeTooltip>
  );
}

/**
 * How the menu's button reads: plain, or naming the device being styled when
 * that device is in the menu. Its tooltip says what a button's says, since
 * the button shows the device's glyph alone.
 */
function moreDevicesTrigger(chosen: DeviceOption | undefined): {
  name: string;
  tip: string;
  tone: string;
} {
  if (chosen === undefined) {
    return {
      name: "More devices",
      tip: "More devices",
      tone: "text-muted-foreground",
    };
  }
  return {
    name: `More devices, styling ${deviceName(chosen)}`,
    tip: deviceName(chosen),
    tone: "bg-accent text-accent-foreground",
  };
}

/**
 * The devices past the third, in a menu of their own.
 *
 * Its button shows the glyph of the device being styled while that device is
 * one of these, and names it; otherwise it is a plain "More devices".
 */
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
      <ChromeTooltip content={trigger.tip} disabled={!ready}>
        <DropdownMenuTrigger
          disabled={!ready}
          aria-label={trigger.name}
          {...(chosen === undefined ? {} : { "data-styling": "" })}
          className={cn(
            "inline-flex h-full items-center gap-1 rounded px-1.5 text-xs disabled:opacity-40",
            FOCUS_RING,
            trigger.tone
          )}
        >
          {chosen === undefined ? null : <DeviceGlyph device={chosen} />}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
      </ChromeTooltip>
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
              aria-label={deviceName(device)}
            >
              {shownLabel(device)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The width the canvas is laid out at, beside the buttons at every top-bar
 * width: the devices are icons, and this is the number an author styles
 * against. Where the host previews other widths it is a button to type one,
 * and a width other than the device's own is in the warning colour with
 * Reset. Otherwise it is text hidden from assistive technology, which hears
 * it in the chosen device's name and in the switcher's announcement.
 */
function ActiveWidth({
  deviceWidth,
  breakpoints,
  previewed,
  onPreviewWidth,
}: {
  deviceWidth: number;
  breakpoints: BreakpointSet | undefined;
  previewed: number | null;
  onPreviewWidth: ((width: number | null) => void) | undefined;
}): React.JSX.Element {
  if (onPreviewWidth === undefined) {
    return (
      <span
        data-nx-active-width=""
        aria-hidden="true"
        className="px-1.5 text-xs tabular-nums"
      >
        {`${deviceWidth}px`}
      </span>
    );
  }
  return (
    <PreviewWidthText
      shown={previewed ?? deviceWidth}
      previewing={previewed !== null}
      deviceWidth={deviceWidth}
      range={previewWidthRange(breakpoints)}
      onPreviewWidth={onPreviewWidth}
    />
  );
}

/**
 * The width on a site with no device to switch to, where the host previews
 * other widths: the canvas still takes any width from its handles, so the
 * width and Reset are offered without the buttons. Desktop's own width is
 * the widest a preview reaches.
 */
function WidthWithoutDevices({
  ready,
  breakpoints,
  previewed,
  onPreviewWidth,
}: {
  ready: boolean;
  breakpoints: BreakpointSet | undefined;
  previewed: number | null;
  onPreviewWidth: ((width: number | null) => void) | undefined;
}): React.JSX.Element | null {
  if (!ready || onPreviewWidth === undefined) return null;
  return (
    <div className="inline-flex h-[var(--nx-builder-control-height,1.75rem)] items-center rounded-md border p-0.5">
      <ActiveWidth
        deviceWidth={previewWidthRange(breakpoints).max}
        breakpoints={breakpoints}
        previewed={previewed}
        onPreviewWidth={onPreviewWidth}
      />
    </div>
  );
}

export function BreakpointSwitcher({
  breakpoints,
  selected,
  onSelect,
  status,
  previewWidth: previewed = null,
  onPreviewWidth,
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

  // Desktop alone is not a choice: the device buttons appear once the site
  // has a breakpoint to switch to. A previewed width still has its own.
  if (options.length < 2) {
    return (
      <WidthWithoutDevices
        ready={ready}
        breakpoints={breakpoints}
        previewed={previewed}
        onPreviewWidth={onPreviewWidth}
      />
    );
  }

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
        {buttons.map((option, index) => (
          <DeviceButton
            key={option.id}
            option={option}
            isSelected={ready && index === buttonIndex}
            ready={ready}
            status={status}
            inTabOrder={index === Math.max(buttonIndex, 0)}
            buttonRef={element => {
              radios.current[index] = element;
            }}
            onSelect={onSelect}
          />
        ))}
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
      {ready && active?.preview !== undefined ? (
        <ActiveWidth
          deviceWidth={active.preview}
          breakpoints={breakpoints}
          previewed={previewed}
          onPreviewWidth={onPreviewWidth}
        />
      ) : null}
    </div>
  );
}
