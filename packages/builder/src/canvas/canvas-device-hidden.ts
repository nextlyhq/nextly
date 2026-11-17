/**
 * The blocks the page hides on the device the canvas shows, drawn anyway and
 * striped, so a block a visitor on that device won't see is still there to
 * find, select and edit.
 *
 * Editor-only by construction, as the reveal of a selected hidden block is:
 * the canvas draws a derived document with those blocks' device hiding
 * lifted, and the editor saves its own, so nothing here reaches what is
 * stored or published. The stripe is a mark on the block's element, drawn by
 * the frame's own sheet (`canvas-frame-sheet.ts`); the site sheet never
 * carries it.
 *
 * Which device the canvas shows is read from the width its page is laid out
 * at, the one its media queries answer for, through the same reading the
 * device buttons size the canvas by. So the stripe is drawn exactly where the
 * page's own CSS would hide the block.
 *
 * @module canvas-device-hidden
 */

import {
  hiddenOnDevice,
  revealDeviceHidden,
  walkNodes,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { useMemo } from "react";

import { deviceLabel } from "../shell/breakpoint-switcher";

import { useCanvasFrame } from "./canvas-frame-context";
import { editedBreakpointAtWidth } from "./canvas-width";

/**
 * Marks a block the page hides on the device shown, drawn striped. Its value
 * is the tag the stripe carries: "Hidden on Mobile · still here in the
 * builder".
 */
export const DEVICE_HIDDEN_ATTRIBUTE = "data-nx-device-hidden";

/** The tag on a block hidden on `device`. */
export function deviceHiddenTag(device: string): string {
  return `Hidden on ${device} · still here in the builder`;
}

/** The page as the canvas draws it, and the blocks it stripes, by id. */
export interface DeviceHiddenDrawing {
  readonly document: BlockDocument;
  /** Each striped block's tag, by id. */
  readonly marks: ReadonlyMap<string, string>;
}

const NO_MARKS: ReadonlyMap<string, string> = new Map();

/**
 * The page with every block hidden on `device` drawn, and those blocks'
 * tags. The same document, and no marks, when no block is hidden there.
 */
export function deviceHiddenDrawing(
  document: BlockDocument,
  breakpoints: BreakpointSet | undefined,
  device: string
): DeviceHiddenDrawing {
  const ids: string[] = [];
  walkNodes(document.nodes, node => {
    if (hiddenOnDevice(node.visibility, breakpoints, device)) ids.push(node.id);
  });
  if (ids.length === 0) return { document, marks: NO_MARKS };
  const tag = deviceHiddenTag(deviceLabel(breakpoints, device) ?? device);
  return {
    document: revealDeviceHidden(document, ids),
    marks: new Map(ids.map(id => [id, tag])),
  };
}

/**
 * {@link deviceHiddenDrawing} for the device the canvas is laid out at.
 * `striping` false draws the page as a visitor gets it, as "Preview as
 * visitor" does: nothing lifted, nothing striped.
 */
export function useDeviceHiddenDrawing(
  document: BlockDocument,
  breakpoints: BreakpointSet | undefined,
  striping: boolean
): DeviceHiddenDrawing {
  const canvas = useCanvasFrame();
  // The width the page's media queries read: its window's, scrollbar and
  // all. Read again whenever the frame reports a new viewport, which is when
  // that width can have changed.
  const width = canvas.window?.innerWidth ?? canvas.viewport?.width;
  const device = editedBreakpointAtWidth(breakpoints, width);
  return useMemo(
    () =>
      striping
        ? deviceHiddenDrawing(document, breakpoints, device)
        : { document, marks: NO_MARKS },
    [document, breakpoints, device, striping]
  );
}
