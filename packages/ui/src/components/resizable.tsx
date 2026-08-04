/**
 * Resizable panel group
 *
 * Side-by-side or stacked regions whose sizes the user can drag, built on `react-resizable-panels`.
 * An editor shell is exactly this: a rail, a canvas and an inspector, each of which someone will
 * want wider than we chose for them.
 *
 * **Why a library rather than a drag handler**: the hard parts of a splitter are not the drag.
 * They are the keyboard model (the APG window-splitter pattern — arrows resize, Home and End go
 * to the extremes), collapse-and-restore, minimum sizes that survive a window resize, and nested
 * groups. `react-resizable-panels` implements all of them, and is the library the wider React
 * ecosystem settled on for this control.
 *
 * **Sizes are relative, not pixels.** A layout stored in pixels is wrong on the next monitor; one
 * stored proportionally survives a window resize. Persisting a shell layout is the caller's to
 * store wherever it already keeps preferences — this kit does not reach for browser storage on
 * their behalf.
 *
 * The two size props are not the same shape, which is easy to get wrong in both directions:
 * `defaultLayout` is a map of panel id to a **number** (a flex-grow weight, conventionally read as
 * a percentage by making them sum to 100), while per-panel bounds such as `minSize` take a CSS
 * **string** like `"15%"`. Handing `defaultLayout` strings is a type error, and a JavaScript
 * caller who does it stores a layout the library cannot restore.
 *
 * Persist from **`onLayoutChanged`**, not `onLayoutChange`: the first fires once the drag has
 * settled, the second fires continuously while the pointer moves. Writing on every frame of a
 * drag thrashes whatever is behind it, which for a remote preference store means a request per
 * frame.
 *
 * **Design specifications**:
 * - Handle: 1px visible line in `bg-border`, with a larger invisible hit area around it
 * - Grip: optional 3x4 handle in `bg-border`, `rounded-sm`, for discoverability
 * - Focus: `focus-visible` ring in the focus token, because a splitter is keyboard-operable
 *
 * **Accessibility**:
 * - The handle is a `separator` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, supplied by
 *   the library, so a screen reader announces the split as a percentage
 * - Arrow keys resize, Home/End collapse and expand, Enter toggles a collapsible panel
 * - The hit area is larger than the visible line, so the target is reachable without precision
 *   pointing (WCAG 2.5.8 Target Size)
 *
 * @example
 * ```tsx
 * <ResizablePanelGroup
 *   orientation="horizontal"
 *   defaultLayout={{ layers: 20, canvas: 55, inspector: 25 }}
 *   onLayoutChanged={saveLayout}
 * >
 *   <ResizablePanel id="layers" minSize="15%" collapsible>
 *     <LayersPanel />
 *   </ResizablePanel>
 *   <ResizableHandle withGrip />
 *   <ResizablePanel id="canvas">
 *     <Canvas />
 *   </ResizablePanel>
 *   <ResizableHandle withGrip />
 *   <ResizablePanel id="inspector" minSize="20%">
 *     <Inspector />
 *   </ResizablePanel>
 * </ResizablePanelGroup>
 * ```
 *
 * @module
 */

"use client";

import { GripVertical } from "lucide-react";
import type * as React from "react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "../lib/utils";

/**
 * A group of resizable panels, laid out horizontally or vertically.
 *
 * @experimental
 */
const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group
    className={cn("h-full w-full", className)}
    {...props}
  />
);

/**
 * One region of a panel group.
 *
 * @experimental
 */
const ResizablePanel = ResizablePrimitive.Panel;

/**
 * The draggable divider between two panels.
 *
 * The visible line is 1px; the element around it is wider and transparent, so the pointer target
 * is comfortably larger than the line it appears to grab. `withGrip` adds a visible handle, which
 * is worth it on a divider people are meant to discover rather than one they already expect.
 *
 * @experimental
 */
const ResizableHandle = ({
  withGrip,
  className,
  children,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withGrip?: boolean;
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      // The drawn line is 1px; the element around it is wider and transparent, so the pointer
      // target is comfortably larger than what it appears to grab (WCAG 2.5.8).
      "relative flex items-center justify-center bg-border",
      // Keyed off `aria-orientation`, which is what the separator actually carries, and read as
      // the ARIA spec defines it: the attribute describes the SEPARATOR, not the group. A
      // horizontal group puts its panels side by side, so its separator is a vertical line.
      "aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      // Reachable without precision pointing, without drawing a heavier divider: the hit area
      // grows across the line, so a vertical line widens and a horizontal one deepens.
      "after:absolute after:inset-0",
      "aria-[orientation=vertical]:after:-inset-x-1 aria-[orientation=horizontal]:after:-inset-y-1",
      className
    )}
    {...props}
  >
    {withGrip ? (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-border">
        <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
      </div>
    ) : null}
    {children}
  </ResizablePrimitive.Separator>
);

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
