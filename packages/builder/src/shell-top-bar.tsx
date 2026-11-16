"use client";

/**
 * The shell's top bar: the exit, the host's items in its three columns, the
 * zoom and the toggles that show or hide each side panel.
 *
 * @module shell-top-bar
 */
import { cn } from "@nextlyhq/ui/utils";
import { ArrowLeft, PanelLeft, PanelRight } from "lucide-react";
import * as React from "react";

import type { CanvasZoom } from "./canvas-zoom";
import { CanvasZoomControl } from "./canvas-zoom-control";
import type { BuilderShellProps } from "./shell-props";

/**
 * The editor's top bar: three columns, the outer two equal, so the centre one
 * (the devices and the zoom) stays in the middle of the editor whatever the
 * sides hold. The shell draws its own controls here (exit, the zoom, the side
 * toggles) around what the host puts in each column.
 */
export function ShellTopBar({
  headerRef,
  onExit,
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
  "onExit" | "title" | "topBar" | "topBarCenter" | "topBarEnd"
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
  return (
    <header
      ref={headerRef}
      // Focusable by F6, not by Tab: Tab reaches the controls inside it.
      tabIndex={-1}
      // Three columns, the outer two equal, so the centre column (the
      // devices and the zoom) sits in the middle of the editor whatever the
      // sides hold. A container, so controls inside can give way by width.
      // `nx-builder-topbar` sets every control inside at the editor's density.
      className="nx-builder-topbar border-[color:var(--nx-builder-border)] @container/topbar grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b px-2"
      aria-label="Editor actions"
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
             * The NAME stays "Exit editor" while the label becomes a glyph.
             * This is the only route back to the document — `ChromeSuppression`
             * withholds the navigation rail from a surface that cannot be left,
             * on the grounds that an author with unsaved work and no way out is
             * the worst state the editor can reach — so it keeps a real
             * accessible name and a tooltip rather than relying on the arrow
             * being self-evident.
             *
             * An arrow rather than a cross: this returns to the document that
             * opened the editor, and a cross reads as discarding rather than
             * as going back.
             */
            aria-label="Exit editor"
            title="Exit editor"
            // A square at the editor's control height, as the bar's others are.
            className="border-[color:var(--nx-builder-border)] focus-visible:ring-ring inline-flex size-[var(--nx-builder-control-height)] items-center justify-center rounded-md border focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        {title !== undefined && title !== "" ? (
          <span
            title={title}
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
        {/* `null` and `false` are what a conditional slot gives when it is
          empty, so they draw no rule either. */}
        {topBarEnd === undefined ||
        topBarEnd === null ||
        topBarEnd === false ? null : (
          <>
            <span
              aria-hidden="true"
              className="h-5 w-px shrink-0 bg-[color:var(--nx-builder-border)]"
            />
            {topBarEnd}
          </>
        )}
      </div>
    </header>
  );
}

/**
 * The top bar's buttons that show or hide each side of the editor, so the
 * canvas can take the room. Pressed means shown; each keeps its panel's name,
 * and the pressed state says which way it is. The left one is drawn only when
 * the host offers a left panel, since with none it could show nothing.
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
  const toggle = (
    label: string,
    shown: boolean,
    onClick: () => void,
    Icon: typeof PanelLeft
  ) => (
    <button
      type="button"
      aria-pressed={shown}
      aria-label={label}
      title={`${shown ? "Hide" : "Show"} the ${label.toLowerCase()}`}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none",
        shown
          ? "text-[color:var(--nx-builder-text)]"
          : "text-[color:var(--nx-builder-text-muted)]"
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {onLeft === undefined
        ? null
        : toggle("Left panel", leftShown, onLeft, PanelLeft)}
      {toggle("Inspector", inspectorShown, onInspector, PanelRight)}
    </div>
  );
}
