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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type * as React from "react";

import { FIT_ZOOM, ZOOM_STEPS, type CanvasZoom } from "./canvas-zoom";

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

export function CanvasZoomControl({
  zoom,
  appliedScale,
  onChange,
}: CanvasZoomControlProps): React.JSX.Element | null {
  if (onChange === undefined) return null;
  const shown = asPercent(appliedScale);
  return (
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
        <DropdownMenuItem
          onSelect={() => {
            onChange(FIT_ZOOM);
          }}
        >
          Fit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ZOOM_STEPS.map(step => (
          <DropdownMenuItem
            key={step}
            onSelect={() => {
              onChange({ kind: "fixed", scale: step });
            }}
          >
            {asPercent(step)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
