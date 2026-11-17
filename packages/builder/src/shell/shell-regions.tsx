"use client";

/**
 * The shell's regions laid out: the top bar, the rail, the switched panel,
 * the canvas and the inspector, with their resizable widths.
 *
 * @module shell-regions
 */
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import * as React from "react";

import type { CanvasZoom } from "../canvas-zoom";
import { useZoomShortcuts } from "../canvas-zoom-control";
import {
  BUILDER_CHROME_CLASS,
  MIN_CANVAS_PANEL_WIDTH,
  PANEL_BOUNDS,
  topologyKey,
  type ShellPreferences,
} from "../shell-state";

import { panelLabel } from "./editor-rail";
import { CanvasPanelBody } from "./shell-canvas-region";
import type { BuilderShellProps, PanelView } from "./shell-props";
import {
  panelAvailability,
  panelTopology,
  RailAndDialogs,
} from "./shell-rail-dialogs";
import {
  useRegionCycling,
  useSeparatorRegionEscape,
  type Region,
} from "./shell-region-cycling";
import { useSidePanels } from "./shell-side-panels";
import {
  PANEL_DIVIDER_CLASS,
  SIDE_PANEL_CLASS,
  useDesignSystemStylesheet,
} from "./shell-stylesheet";
import { ShellTopBar } from "./shell-top-bar";

export function ShellRegions({
  appliedScale = 1,
  onZoomPick,
  renderPanel,
  renderSettings,
  availablePanels,
  children,
  inspector,
  title,
  topBar,
  topBarCenter,
  topBarEnd,
  breadcrumb,
  checklist,
  canvasStrip,
  onExit,
  preferences,
  update,
  className,
  active,
  loadCount,
}: Omit<BuilderShellProps, "store"> & {
  /** The zoom picker, or absent where the host wired none. */
  onZoomPick: ((next: CanvasZoom) => void) | undefined;
  preferences: ShellPreferences;
  update: (change: (current: ShellPreferences) => ShellPreferences) => void;
  /**
   * Whether this subtree is the one the author is using.
   *
   * False while it sits mounted-but-hidden behind the narrow-viewport notice,
   * which is a state it cannot detect for itself: from in here a hidden shell
   * and a visible one render identically.
   */
  active: boolean;
  /**
   * How many times preferences have been loaded from a store.
   *
   * Restoring a layout happens once per load, and this is what "once" is
   * counted against: the group is remounted per load so the library
   * re-reads the restored layout at panel registration.
   *
   * ANY load, deliberately — unlike the write guard on the token effect, which
   * has to know WHOSE record arrived. A remount is a response to a new layout
   * being on screen, and the panels have to re-register against it whichever
   * store produced it: the swap that makes a count useless for deciding a write
   * is exactly a case that must remount. So the count and the identity are two
   * separate answers rather than one this could share.
   */
  loadCount: number;
}): React.JSX.Element {
  const regionRefs = React.useRef<Record<Region, HTMLElement | null>>({
    header: null,
    rail: null,
    panel: null,
    canvas: null,
    inspector: null,
  });
  // Declared before the hook that reads it: `chromeRef` is the shell's own root
  // element, which is what decides whether the author is inside this editor at
  // all — the chrome header sits outside every region but inside this.
  const chromeRef = React.useRef<HTMLDivElement | null>(null);
  const claimsKeys = useRegionCycling(regionRefs, chromeRef, active);
  useZoomShortcuts(onZoomPick, active, claimsKeys);
  const onKeyDownCapture = useSeparatorRegionEscape(regionRefs, active);
  useDesignSystemStylesheet(chromeRef);

  // Whether the host can fill a panel: see `panelAvailability`.
  const isAvailable = panelAvailability(availablePanels);

  /**
   * The open panel, NORMALISED against what the host can fill.
   *
   * Preferences outlive the code that wrote them, and availability can change
   * between mounts — a store restoring `layers` while the host now offers only
   * `add` would reserve a left panel whose content renders nothing. Leaving the
   * item off the rail does not help: nobody clicked it, the selection was
   * restored.
   *
   * Treated as closed instead, which is the same answer the shell gives for a
   * panel name it no longer recognises.
   */
  const {
    openPanel,
    inspectorShown,
    leftShown,
    selectPanel,
    toggleLeft,
    toggleInspector,
  } = useSidePanels(
    preferences,
    update,
    isAvailable,
    active,
    claimsKeys,
    regionRefs
  );
  const mountedTopology = panelTopology(openPanel, inspectorShown);

  const panelView: PanelView = {
    current: preferences.leftPanelView,
    choose: view => update(current => ({ ...current, leftPanelView: view })),
  };

  return (
    <div
      ref={chromeRef}
      onKeyDownCapture={onKeyDownCapture}
      className={cn(
        BUILDER_CHROME_CLASS,
        "flex h-full w-full flex-col overflow-hidden",
        className
      )}
    >
      <ShellTopBar
        headerRef={element => {
          regionRefs.current.header = element;
        }}
        onExit={onExit}
        title={title}
        topBar={topBar}
        topBarCenter={topBarCenter}
        topBarEnd={topBarEnd}
        zoom={preferences.zoom}
        appliedScale={appliedScale}
        onZoomPick={onZoomPick}
        leftShown={leftShown}
        inspectorShown={inspectorShown}
        onLeft={toggleLeft}
        onInspector={toggleInspector}
      />

      <div className="flex min-h-0 flex-1">
        <RailAndDialogs
          active={active}
          renderSettings={renderSettings}
          railRef={element => {
            regionRefs.current.rail = element;
          }}
          openPanel={openPanel}
          isAvailable={isAvailable}
          onSelect={selectPanel}
          // The panel keys answer only for the shell that is showing and that
          // the author is in, the check F6 and mod+\ already make, and only
          // while the author has not turned them off in Help.
          claimsKeys={() => active && claimsKeys()}
          panelKeys={{
            // On unless turned off, as a preference written before there
            // was a switch reads.
            on: preferences.panelKeys !== false,
            onChange: on => update(current => ({ ...current, panelKeys: on })),
          }}
        />

        <ResizablePanelGroup
          // Remounted when a store is LOADED, which is the only way the library
          // applies a layout: it reads `defaultLayout` when the panels REGISTER
          // and a later prop change merely assigns it. Restoration therefore
          // happens where the library already does it, rather than being
          // reapplied afterwards through the imperative API — which is what made
          // the units, the key order and the mount timing this component's
          // problems to solve.
          key={loadCount}
          orientation="horizontal"
          // Selected by the panel set actually mounted, so an arrangement with
          // no stored layout falls through to the panels' declared widths
          // instead of inheriting another arrangement's.
          defaultLayout={preferences.layouts[mountedTopology]}
          onLayoutChanged={(layout, meta) => {
            // The group reports every layout it settles on, not only the ones a
            // person asked for. Mounting, recomputing constraints and reacting
            // to a changed default all arrive here too, and the mount pass
            // arrives BEFORE the restored layout has taken effect — so writing
            // unconditionally saves the freshly measured default over the
            // layout being restored, and the panel widths reset on every
            // reload while appearing to persist within a session.
            //
            // `isUserInteraction` is the library's own account of which of
            // those it was: true only for a pointer drag or a resize key on a
            // separator. Dragging a separator is the one event that states an
            // intent about widths, and it is the only one worth remembering.
            if (!meta.isUserInteraction) return;
            // Stored under the topology it was measured for, and keyed from the
            // layout's OWN ids rather than from a separate description of the
            // panel set. `defaultLayout` consumes the same flex-grow weights
            // this reports, so the value makes a round trip in one unit and
            // never meets the percentage side of the API.
            update(current => ({
              ...current,
              layouts: {
                ...current.layouts,
                [topologyKey(Object.keys(layout))]: { ...layout },
              },
            }));
          }}
          className="min-w-0 flex-1"
        >
          {openPanel !== null ? (
            <>
              <ResizablePanel
                id="panel"
                minSize={PANEL_BOUNDS.left.min}
                maxSize={PANEL_BOUNDS.left.max}
                defaultSize={PANEL_BOUNDS.left.initial}
              >
                <section
                  ref={element => {
                    regionRefs.current.panel = element;
                  }}
                  tabIndex={-1}
                  aria-label={panelLabel(openPanel)}
                  className={SIDE_PANEL_CLASS}
                >
                  {/* Keyed by the panel, because the prop's contract says the
                      result is keyed by the panel and React's default
                      reconciliation does not honour that. A caller rendering one
                      component for several panels — `<MyPanel kind={panel} />`,
                      which is what this package's own README suggests — puts the
                      same element type at the same position, so switching from
                      Layers to Tokens UPDATES that instance rather than mounting
                      a new one: its state, its effects and any uncontrolled
                      input values follow the author into a different tool. */}
                  <React.Fragment key={openPanel}>
                    {renderPanel?.(openPanel, panelView)}
                  </React.Fragment>
                </section>
              </ResizablePanel>
              {/* Named for what it DIVIDES rather than for itself. A keyboard
                  user lands here between two regions and hears its position;
                  "Panel and canvas" is what makes the position mean something.
                  The panel side is named by its role rather than by which
                  panel is open, because the name would otherwise change under
                  a user who is standing on it. */}
              <ResizableHandle
                withGrip
                aria-label="Panel and canvas"
                className={PANEL_DIVIDER_CLASS}
              />
            </>
          ) : null}

          <ResizablePanel id="canvas" minSize={MIN_CANVAS_PANEL_WIDTH}>
            <CanvasPanelBody
              canvasStrip={canvasStrip}
              checklist={checklist}
              regionRef={element => {
                regionRefs.current.canvas = element;
              }}
            >
              {children}
            </CanvasPanelBody>
          </ResizablePanel>

          {inspectorShown ? (
            <>
              <ResizableHandle
                withGrip
                aria-label="Canvas and inspector"
                className={PANEL_DIVIDER_CLASS}
              />

              <ResizablePanel
                id="inspector"
                minSize={PANEL_BOUNDS.inspector.min}
                maxSize={PANEL_BOUNDS.inspector.max}
                defaultSize={PANEL_BOUNDS.inspector.initial}
              >
                <aside
                  ref={element => {
                    regionRefs.current.inspector = element;
                  }}
                  tabIndex={-1}
                  aria-label="Inspector"
                  className={SIDE_PANEL_CLASS}
                >
                  {inspector}
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      </div>

      {/*
        No `aria-label`. A `<footer>` nested inside a section is `generic`, and
        `aria-label` is PROHIBITED on that role — so the name was not announced
        and the element was invalid. Nothing is lost: the breadcrumb inside
        names itself ("Current location"), which is the thing a
        reader actually lands on.
      */}
      <footer className="border-[color:var(--nx-builder-divider)] text-[color:var(--nx-builder-text-muted)] flex h-8 shrink-0 items-center gap-2 border-t px-3 text-xs">
        {breadcrumb}
      </footer>
    </div>
  );
}
