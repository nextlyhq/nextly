"use client";

/**
 * The shell's top bar: the exit, the host's items in its three columns, the
 * zoom and the toggles that show or hide each side panel.
 *
 * @module shell-top-bar
 */
import { cn } from "@nextlyhq/ui/utils";
import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import * as React from "react";

import type { CanvasZoom } from "../canvas/canvas-zoom";
import { CanvasZoomControl } from "../canvas/canvas-zoom-control";
import { ChromeTooltip } from "../chrome-tooltip";

import type { BuilderShellProps } from "./shell-props";
import { PANEL_DIVIDER_CLASS } from "./shell-stylesheet";
import { useTopBarRoom } from "./top-bar-room";

/**
 * The exit's words where the host names no other: it returns to the document
 * that opened the editor.
 */
export const DEFAULT_EXIT_LABEL = "Exit editor";

/**
 * The editor's top bar: three columns, the outer two equal while there is
 * room, so the centre one (the devices and the zoom) stays in the middle of
 * the editor. The shell draws its own controls here (exit, the zoom, the side
 * toggles) around what the host puts in each column.
 *
 * As room runs out the bar gives way in one order: the title shortens first,
 * and once it is at its shortest the bar is crowded (`data-crowded`), and the
 * words marked `data-topbar-word` step aside, keeping their icons and names
 * (`top-bar-room`). Nothing else shortens.
 */
export function ShellTopBar({
  headerRef,
  onExit,
  exitLabel = DEFAULT_EXIT_LABEL,
  title,
  topBar,
  topBarCenter,
  topBarEnd,
  zoom,
  appliedScale,
  onZoomPick,
  leftShown,
  inspectorShown,
  onLeft,
  onInspector,
}: Pick<
  BuilderShellProps,
  "onExit" | "exitLabel" | "title" | "topBar" | "topBarCenter" | "topBarEnd"
> & {
  headerRef: (element: HTMLElement | null) => void;
  zoom: CanvasZoom;
  appliedScale: number;
  onZoomPick: ((next: CanvasZoom) => void) | undefined;
  leftShown: boolean;
  inspectorShown: boolean;
  /** Absent when the host offers no left panel, so there is nothing to show. */
  onLeft: (() => void) | undefined;
  onInspector: () => void;
}): React.JSX.Element {
  // The bar itself, kept here as well as handed to the shell, so it can be
  // measured for room.
  const { ref, crowded } = useTopBarRoom(headerRef);
  return (
    <header
      ref={ref}
      // Focusable by F6, not by Tab: Tab reaches the controls inside it.
      tabIndex={-1}
      // Three columns, the outer two equal while there is room, so the
      // centre column (the devices and the zoom) sits in the middle of the
      // editor. The end column never takes less than its controls need, so
      // Save, Publish and the buttons beside them are always whole and never
      // drawn over the centre; when the sides cannot both have half, the
      // start column, whose title shortens, is the one that gives way. A
      // container, so controls inside can give way by width.
      // `nx-builder-topbar` sets every control inside at the editor's density.
      className="nx-builder-topbar border-[color:var(--nx-builder-divider)] @container/topbar grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 border-b px-2"
      aria-label="Editor actions"
      // Crowded once the title is at its shortest: the words that step
      // aside next do so (`nx-builder-topbar` in the stylesheet).
      data-crowded={crowded ? "" : undefined}
    >
      <div data-topbar="start" className="flex min-w-0 items-center gap-2">
        {/*
         * Rendered only when there is somewhere to go. A button carrying no
         * handler still looks operable — it takes focus, it depresses — and
         * teaches the author that leaving does nothing, which is worse than
         * offering no exit at all.
         */}
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            data-builder-animates
            /*
             * The NAME stays the exit's words ("Exit editor", or where the
             * host's exit goes) while the label becomes a glyph.
             * This is the only way out of the editor — `ChromeSuppression`
             * withholds the navigation rail from a surface that cannot be left,
             * on the grounds that an author with unsaved work and no way out is
             * the worst state the editor can reach — so it keeps a real
             * accessible name and a tooltip rather than relying on the arrow
             * being self-evident.
             *
             * An arrow rather than a cross: this goes back, to the document
             * that opened the editor or the list the host names, and a cross
             * reads as discarding rather than as going back.
             */
            aria-label={exitLabel}
            title={exitLabel}
            // A square at the editor's control height, as the bar's others are.
            // Never squeezed by a long title beside it: the title shortens.
            className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring inline-flex size-[var(--nx-builder-control-height)] shrink-0 items-center justify-center rounded-md border focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        {title !== undefined && title !== "" ? (
          <span
            title={title}
            // The control that shortens first, as far as nothing.
            data-topbar-shortens=""
            className="min-w-0 shrink truncate text-sm font-medium"
          >
            {title}
          </span>
        ) : null}
        {topBar}
      </div>
      <div data-topbar="centre" className="flex items-center gap-2">
        {topBarCenter}
        {/*
          Rendered by the shell, not handed to the host as a slot, because the
          shell owns preferences and this control edits one. A host drawing its
          own would hold the value in a second place, and the two would correct
          each other on every open.

          Only where the host has WIRED it, though. The canvas belongs to the
          host, so without `onZoomChange` there is nothing to apply a choice to:
          the control would store a preference, report a percentage the canvas
          does not honour, and read 100% whatever was picked. A shell that
          predates this — the README example and the playground harness among
          them — should gain no control rather than a dead one.
        */}
        <CanvasZoomControl
          zoom={zoom}
          appliedScale={appliedScale}
          onChange={onZoomPick}
        />
      </div>
      <div
        data-topbar="end"
        className="flex min-w-0 items-center justify-end gap-2"
      >
        {/* The panel buttons first, then the document's own controls after a
          thin rule, so the bar ends on the action that leads, as the
          accepted layout has it. */}
        <SidePanelToggles
          leftShown={leftShown}
          inspectorShown={inspectorShown}
          onLeft={onLeft}
          onInspector={onInspector}
        />
        <EndControls topBarEnd={topBarEnd} />
      </div>
    </header>
  );
}

/**
 * The host's controls at the bar's end, after a thin rule. `null` and
 * `false` are what a conditional slot gives when it is empty, so they draw
 * no rule either. Its own component, so the bar's layout reads apart from
 * which of its slots are filled.
 */
function EndControls({
  topBarEnd,
}: Pick<BuilderShellProps, "topBarEnd">): React.JSX.Element | null {
  if (topBarEnd === undefined || topBarEnd === null || topBarEnd === false) {
    return null;
  }
  return (
    <>
      <span
        aria-hidden="true"
        className={cn("h-5 w-px shrink-0", PANEL_DIVIDER_CLASS)}
      />
      {topBarEnd}
    </>
  );
}

/** One side-panel toggle: its stable name, its side, and each state's icon. */
interface SidePanelToggle {
  /** The accessible name, kept as the state changes; pressed says which way. */
  label: string;
  /** The side as the tooltip names it: "the left panel", "the right panel". */
  side: "left" | "right";
  shown: boolean;
  onClick: () => void;
  /** Drawn while the panel shows: the panel closing, what a press does. */
  CloseIcon: typeof PanelLeftClose;
  /** Drawn while the panel is hidden: the panel opening. */
  OpenIcon: typeof PanelLeftOpen;
}

/**
 * A toggle whose look says what pressing it does. While its panel shows, it
 * draws the panel's close icon on a fill and its tooltip reads "Hide the left
 * panel"; while hidden, the open icon with no fill and "Show the left panel".
 * The name stays the panel's and `aria-pressed` carries the state, so a
 * screen reader hears "Left panel, pressed" rather than a name that changes
 * under the author. The fill is `nx-builder-panel-toggle`'s, drawn from
 * `data-shown`, in the base partial.
 */
function PanelToggleButton({
  label,
  side,
  shown,
  onClick,
  CloseIcon,
  OpenIcon,
}: SidePanelToggle): React.JSX.Element {
  const Icon = shown ? CloseIcon : OpenIcon;
  return (
    <ChromeTooltip content={`${shown ? "Hide" : "Show"} the ${side} panel`}>
      <button
        type="button"
        aria-pressed={shown}
        aria-label={label}
        data-shown={shown ? "true" : "false"}
        data-builder-animates
        onClick={onClick}
        className="nx-builder-panel-toggle focus-visible:ring-ring inline-flex size-[var(--nx-builder-control-height)] items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </ChromeTooltip>
  );
}

/**
 * The top bar's buttons that show or hide each side of the editor, so the
 * canvas can take the room. The left one is drawn only when the host offers a
 * left panel, since with none it could show nothing.
 */
function SidePanelToggles({
  leftShown,
  inspectorShown,
  onLeft,
  onInspector,
}: {
  leftShown: boolean;
  inspectorShown: boolean;
  onLeft: (() => void) | undefined;
  onInspector: () => void;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {onLeft === undefined ? null : (
        <PanelToggleButton
          label="Left panel"
          side="left"
          shown={leftShown}
          onClick={onLeft}
          CloseIcon={PanelLeftClose}
          OpenIcon={PanelLeftOpen}
        />
      )}
      <PanelToggleButton
        label="Inspector"
        side="right"
        shown={inspectorShown}
        onClick={onInspector}
        CloseIcon={PanelRightClose}
        OpenIcon={PanelRightOpen}
      />
    </div>
  );
}
