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
 * - `inspector`  configuration that is not the content. Summoned, and rendered
 *                INSIDE `secondary` so it overlays that pane and nothing else.
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

import { ArrowLeft } from "@admin/components/icons";

import { useSuppressAdminChrome } from "../ChromeSuppression";
import type { AdminChromeLayer } from "../lib/chrome-suppression";

/**
 * Panel ids. Exported because `defaultLayout` and `onLayoutChanged` are keyed by
 * them, and a caller persisting a layout needs the same spelling this file uses.
 */
export const SHELL_PRIMARY = "primary";
export const SHELL_SECONDARY = "secondary";

/**
 * A layout for exactly the two panels this shell has.
 *
 * Keyed by the constants rather than by `string`: a misspelled, missing or extra
 * key type-checks against a loose record, and the panel library then cannot
 * restore the map and silently falls back to a different layout — a persisted
 * preference that appears to work and does not.
 */
export type ShellLayout = Record<
  typeof SHELL_PRIMARY | typeof SHELL_SECONDARY,
  number
>;

/**
 * The group's own settled-layout callback, DERIVED from the component rather
 * than restated.
 *
 * Restating it as a one-argument function drops the `meta`, and the `meta` is
 * load-bearing: the group reports the MOUNT pass as well as user drags, and the
 * mount pass arrives BEFORE a restored layout takes effect. A consumer that
 * cannot read `meta.isUserInteraction` writes the freshly measured default over
 * the layout it was restoring, so widths reset on every reload while appearing
 * to persist within a session. `APIPlayground` filters on exactly that, and a
 * narrowed type here would have made that filter impossible to write.
 */
export type ShellLayoutChanged = NonNullable<
  React.ComponentProps<typeof ResizablePanelGroup>["onLayoutChanged"]
>;

export interface ImmersiveShellProps {
  /** Region 01 — identity, and the controls that leave the page. */
  bar: React.ReactNode;
  /** Region 02 — an optional strip beneath the bar. */
  band?: React.ReactNode;
  /** Region 03 — the thing being authored. */
  primary: React.ReactNode;
  /** Region 04 — its consequence, beside it. */
  secondary: React.ReactNode;
  /** Region 05 — summoned configuration, overlaying region 04 only. */
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
   * Leaves this surface. Rendered by the SHELL, as a control in region 01.
   *
   * The shell renders it rather than trusting a caller to, because `canExit` is
   * derived from it. A surface may only take the admin's primary rail — its
   * whole navigation — when a way back demonstrably exists, and `bar` is a
   * `ReactNode` that may be a title, a heading, or nothing at all. Treating the
   * presence of a slot as proof of an exit is how an author holding unsaved
   * work is left with no route anywhere except the browser's URL bar.
   */
  onExit?: () => void;
  /** Accessible name for the exit control. */
  exitLabel?: string;
  /**
   * Which admin furniture to hide for as long as this shell is mounted.
   *
   * Empty by default, so a shell that says nothing takes nothing. The request is
   * mount-scoped: navigating away restores the chrome with nothing to undo.
   * `primaryRail` is granted only alongside `onExit` — see above.
   */
  suppress?: readonly AdminChromeLayer[];
  /**
   * How the two panes divide the body.
   *
   * `vertical` stacks them, which is what a narrow viewport needs: side by side
   * on a phone leaves two columns too thin to author in or to judge from. The
   * caller decides, because only it knows what its own panes cost at a width.
   */
  orientation?: "horizontal" | "vertical";
  /** Relative weights for the two panes, conventionally summing to 100. */
  defaultLayout?: ShellLayout;
  /**
   * Called once a drag has SETTLED, never per frame — persisting on every frame
   * of a drag is a write per frame to whatever is behind the caller's store.
   * Receives the group's `meta`; read `ShellLayoutChanged` before ignoring it.
   */
  onLayoutChanged?: ShellLayoutChanged;
}

export function ImmersiveShell({
  bar,
  band,
  primary,
  secondary,
  inspector,
  drawer,
  splitLabel,
  onExit,
  exitLabel = "Back",
  suppress = [],
  orientation = "horizontal",
  defaultLayout = { [SHELL_PRIMARY]: 50, [SHELL_SECONDARY]: 50 },
  onLayoutChanged,
}: ImmersiveShellProps) {
  /*
   * DERIVED from the affordance, never declared beside it. The resolver cannot
   * check a `canExit` claim — it can only withhold the primary rail from a
   * surface that answers false — so the only honest answer is whether this
   * shell actually rendered a way back, which it knows because it renders it.
   */
  const canExit = Boolean(onExit);
  useSuppressAdminChrome({ layers: suppress, canExit });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div
        data-testid="shell-bar"
        className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5"
      >
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            aria-label={exitLabel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">{bar}</div>
      </div>

      {band ? (
        <div data-testid="shell-band" className="shrink-0">
          {band}
        </div>
      ) : null}

      <ResizablePanelGroup
        orientation={orientation}
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
          {/* `relative` HERE is what scopes the inspector. Positioned against
              the shell's outer box instead, it spans the bar and the drawer as
              well, and a right-hand inspector then covers the save and exit
              controls it is meant to sit beside. */}
          <div
            data-testid="shell-secondary"
            className="relative flex h-full min-h-0 flex-col overflow-hidden"
          >
            {secondary}
            {inspector ? (
              <div
                data-testid="shell-inspector"
                className="absolute inset-y-0 right-0 z-20 overflow-y-auto border-l border-border bg-background shadow-lg"
              >
                {inspector}
              </div>
            ) : null}
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
    </div>
  );
}
