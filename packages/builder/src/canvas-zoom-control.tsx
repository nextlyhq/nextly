"use client";

/**
 * The control that says how large the canvas is drawing, and lets an author
 * change it.
 *
 * Both halves matter and the first is the one that was missing. The canvas has
 * always scaled to fit the region the panels leave, so opening a panel took it
 * from 89% to 59.5% with nothing on screen naming either number — an author
 * judging type or spacing was doing it at a size they had not chosen and could
 * not read.
 *
 * ## The percentage is always shown, including while fitting
 *
 * A control that only reported a scale the author had SET would be blank in
 * the state that caused the confusion. Fit is the default and the state an
 * editor spends most of its time in, so the number it produces is exactly the
 * one worth naming.
 *
 * ## Discrete steps, and Fit as a peer of them
 *
 * A menu of steps rather than a slider or a free number: 37% of a page is not
 * a view of anything, and every comparable editor offers steps for the same
 * reason. Fit sits in the same menu rather than beside it as a separate
 * button, because from the author's side it is one question — how big — and
 * splitting it into a mode switch plus a size makes them answer twice.
 *
 * @module canvas-zoom-control
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Minus, Plus } from "lucide-react";
import type * as React from "react";
import { Fragment } from "react";

import {
  FIT_ZOOM,
  ZOOM_STEPS,
  steppedZoom,
  writeZoom,
  type CanvasZoom,
} from "./canvas-zoom";

export interface CanvasZoomControlProps {
  /** What the canvas was asked to draw at. */
  zoom: CanvasZoom;
  /**
   * The scale the canvas is ACTUALLY painting at.
   *
   * Passed in rather than recomputed, because while fitting it is derived from
   * a region only the canvas has measured. A control deriving its own would be
   * a second answer to what is on screen, and the two would disagree for
   * exactly the frame after a panel opens — which is the moment this exists to
   * report.
   */
  appliedScale: number;
  /**
   * What to do with a chosen zoom, or absent where nothing can act on one.
   *
   * Absent renders NOTHING. The canvas belongs to the host, so a shell whose
   * host has not wired this has nowhere to apply a choice: the control would
   * store a preference, report a percentage the canvas does not honour, and go
   * on reading 100% whatever was picked. A surface that predates the wiring
   * should gain no control rather than a dead one.
   */
  onChange?: (zoom: CanvasZoom) => void;
}

/** A scale as a percentage, rounded to whole points. */
function asPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/**
 * A zoom as the string the menu addresses it by.
 *
 * Routed through `writeZoom` rather than spelled here, so the value a checked
 * item is compared against and the value the preference is stored as are one
 * decision. Written twice they agree until one of them learns a new kind, and
 * the failure is a menu with nothing checked rather than an error.
 */
function choiceValue(zoom: CanvasZoom): string {
  return String(writeZoom(zoom));
}

/**
 * Every zoom the menu offers, in the order it offers them.
 *
 * Built once from the steps rather than parsed back out of the chosen string.
 * A parse is a second implementation of what this list already knows, and it
 * has a failure mode the lookup does not: an unrecognised string has to become
 * SOME zoom, so it silently becomes the wrong one.
 */
const CHOICES: readonly { value: string; label: string; zoom: CanvasZoom }[] = [
  { value: choiceValue(FIT_ZOOM), label: "Fit", zoom: FIT_ZOOM },
  ...ZOOM_STEPS.map(step => {
    const zoom: CanvasZoom = { kind: "fixed", scale: step };
    return { value: choiceValue(zoom), label: asPercent(step), zoom };
  }),
];

export function CanvasZoomControl({
  zoom,
  appliedScale,
  onChange,
}: CanvasZoomControlProps): React.JSX.Element | null {
  if (onChange === undefined) return null;
  const shown = asPercent(appliedScale);

  /*
   * The steps this control can still take, so a button that cannot move says
   * so rather than looking operable and doing nothing.
   *
   * Compared against the RESULT rather than against the current scale: at the
   * top step `steppedZoom` returns the zoom it was given, and a disabled state
   * derived from the scale alone would have to restate the step list to know
   * that. One list decides both, and it is the one the button runs.
   *
   * `Object.is` rather than `!==`, because `writeZoom` returns the scale itself
   * and a host may construct one the canvas cannot paint. `NaN !== NaN` is
   * true, so an unchanged result would read as a step being available and both
   * buttons would offer a press that emits the value they were already given.
   */
  const zoomOut = steppedZoom(zoom, appliedScale, "out");
  const zoomIn = steppedZoom(zoom, appliedScale, "in");
  const canZoomOut = !Object.is(writeZoom(zoomOut), writeZoom(zoom));
  const canZoomIn = !Object.is(writeZoom(zoomIn), writeZoom(zoom));

  return (
    <div className="nx-zoom-stepper flex items-center gap-0.5">
      {/*
        A stepper AROUND the menu, not instead of it. The menu names the modes
        — Fit is a mode rather than a number and cannot be stepped to — while
        the buttons are for the adjustment an author makes repeatedly, which a
        menu makes a three-action job every time.

        `steppedZoom` already existed and was exported with no caller: the
        capability was reachable from a host and not from the editor.
      */}
      <button
        type="button"
        onClick={() => onChange(zoomOut)}
        disabled={!canZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
        className="focus-visible:ring-ring rounded p-1 disabled:opacity-40 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="nx-zoom-control"
          /*
           * The accessible name carries the MODE as well as the number, because
           * "89%" alone does not say whether it will move when a panel opens —
           * and that is the whole difference between the two states.
           */
          aria-label={
            zoom.kind === "fit"
              ? `Canvas zoom: fitting, ${shown}`
              : `Canvas zoom: ${shown}`
          }
        >
          <span aria-hidden="true">{shown}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {/* A RADIO group, so the open menu says which mode is active.

            The trigger cannot: Fit resolves to exactly 100% at the widest
            tier, which is the state an editor opens in, so "100%" is the same
            two characters for a canvas that will resize when a panel opens and
            one that will not. The mark is the only place a sighted author can
            read the difference, and a checked radio is also what tells a
            screen reader which item is current.

            Nothing is marked when the zoom is a fixed scale the steps do not
            contain — a host can pass one, and a stored value can outlive the
            step list. That is honest: the menu genuinely does not hold it, and
            marking the nearest step would claim the author chose something
            they did not. */}
          <DropdownMenuRadioGroup
            value={choiceValue(zoom)}
            onValueChange={next => {
              const choice = CHOICES.find(
                candidate => candidate.value === next
              );
              if (choice !== undefined) onChange(choice.zoom);
            }}
          >
            {CHOICES.map((choice, index) => (
              <Fragment key={choice.value}>
                {index === 1 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuRadioItem value={choice.value}>
                  {choice.label}
                </DropdownMenuRadioItem>
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        onClick={() => onChange(zoomIn)}
        disabled={!canZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
        className="focus-visible:ring-ring rounded p-1 disabled:opacity-40 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
