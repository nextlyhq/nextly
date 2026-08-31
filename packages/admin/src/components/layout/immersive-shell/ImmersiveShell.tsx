"use client";

/**
 * The shell an immersive editor renders into, with its regions declared.
 *
 * Four admin surfaces already compose the same three ingredients by hand —
 * suppress the admin's furniture, put a bar on top, split the body with a
 * draggable handle — and each composes them differently. Naming the composition
 * once means a surface declares WHICH regions it has rather than arranging them,
 * and the two questions a shell answers badly when spread across call sites —
 * what may be hidden, and what may be resized — are answered in one place.
 *
 * The regions, and why each exists as its own slot:
 *
 * - `bar`        identity and the acts that leave the page. Always rendered.
 * - `band`       an optional strip under the bar for fields that address the
 *                work rather than being it — an email's envelope, say.
 * - `primary`    the thing being authored.
 * - `secondary`  its consequence, rendered beside it. Draggable against
 *                `primary`, because which of the two deserves the width is the
 *                author's judgement and changes minute to minute.
 * - `inspector`  configuration that is not the content. Summoned, and OVERLAYS
 *                `secondary` rather than displacing it, so the thing being
 *                edited does not reflow while a setting is changed.
 * - `drawer`     instruments rather than settings — sample data, problems,
 *                validation. Collapsible, along the bottom.
 *
 * `primary` and `secondary` are the invariant: everything else may be absent,
 * and those two are always on screen. That is the property every comparable
 * product holds, and the reason the inspector overlays instead of taking a
 * column of its own.
 *
 * @module components/layout/immersive-shell
 */
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@nextlyhq/ui";
import type React from "react";

import { useSuppressAdminChrome } from "../ChromeSuppression";
import type { AdminChromeLayer } from "../lib/chrome-suppression";

/**
 * Panel ids. Exported because `defaultLayout` and `onLayoutChanged` are keyed by
 * them, and a caller persisting a layout needs the same spelling this file uses.
 */
export const SHELL_PRIMARY = "primary";
export const SHELL_SECONDARY = "secondary";

export interface ImmersiveShellProps {
  /** Region 01 — identity, and the controls that leave the page. */
  bar: React.ReactNode;
  /** Region 02 — an optional strip beneath the bar. */
  band?: React.ReactNode;
  /** Region 03 — the thing being authored. */
  primary: React.ReactNode;
  /** Region 04 — its consequence, beside it. */
  secondary: React.ReactNode;
  /** Region 05 — summoned configuration, overlaying region 04. */
  inspector?: React.ReactNode;
  /** Region 06 — collapsible instruments along the bottom. */
  drawer?: React.ReactNode;
  /**
   * Accessible name for the split.
   *
   * Required rather than defaulted: the library supplies a separator's position
   * but not its name, so an unnamed one announces a bare percentage and leaves
   * a keyboard user to guess what is on either side. Only the caller knows.
   */
  splitLabel: string;
  /**
   * Which admin furniture to hide for as long as this shell is mounted.
   *
   * Empty by default, so a shell that says nothing takes nothing. The request is
   * mount-scoped: navigating away restores the chrome with nothing to undo.
   */
  suppress?: readonly AdminChromeLayer[];
  /** Relative weights for the two panes, conventionally summing to 100. */
  defaultLayout?: Record<string, number>;
  /**
   * Called once a drag has SETTLED, never per frame — persisting on every frame
   * of a drag is a write per frame to whatever is behind the caller's store.
   */
  onLayoutChanged?: (layout: Record<string, number>) => void;
}

export function ImmersiveShell({
  bar,
  band,
  primary,
  secondary,
  inspector,
  drawer,
  splitLabel,
  suppress = [],
  defaultLayout = { [SHELL_PRIMARY]: 50, [SHELL_SECONDARY]: 50 },
  onLayoutChanged,
}: ImmersiveShellProps) {
  /*
   * `canExit` is true because region 01 always renders and is where a surface
   * puts its way back. It is a claim the resolver cannot check — it can only
   * withhold the primary rail from a surface that answers false — so it is made
   * here, where the bar's presence is guaranteed by the type, rather than left
   * to each caller to assert about itself.
   */
  useSuppressAdminChrome({ layers: suppress, canExit: true });

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div data-testid="shell-bar" className="shrink-0">
        {bar}
      </div>

      {band ? (
        <div data-testid="shell-band" className="shrink-0">
          {band}
        </div>
      ) : null}

      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="min-h-0 flex-1"
      >
        {/* Percentage strings, not numbers: this library reads a bare number as
            PIXELS, so `minSize={25}` is a 25-pixel floor rather than a quarter
            of the group. */}
        <ResizablePanel id={SHELL_PRIMARY} minSize="25%">
          <div
            data-testid="shell-primary"
            className="flex h-full min-h-0 flex-col overflow-hidden"
          >
            {primary}
          </div>
        </ResizablePanel>

        <ResizableHandle withGrip aria-label={splitLabel} />

        <ResizablePanel id={SHELL_SECONDARY} minSize="25%">
          <div
            data-testid="shell-secondary"
            className="flex h-full min-h-0 flex-col overflow-hidden"
          >
            {secondary}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {drawer ? (
        <div
          data-testid="shell-drawer"
          className="shrink-0 border-t border-border"
        >
          {drawer}
        </div>
      ) : null}

      {/* Out of the flow on purpose. In the flow it would take width from the
          panes, so opening it would reflow the document being edited — the one
          thing a settings panel must not do to an author mid-sentence. */}
      {inspector ? (
        <div
          data-testid="shell-inspector"
          className="absolute inset-y-0 right-0 z-20 overflow-y-auto border-l border-border bg-background shadow-lg"
        >
          {inspector}
        </div>
      ) : null}
    </div>
  );
}
