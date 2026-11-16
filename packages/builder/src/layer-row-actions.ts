/**
 * What a Layers row's own actions do: hide or show its block on the device
 * being edited, and the keystrokes that reach the row's actions from the
 * keyboard.
 *
 * Pure, so the write each action makes is asserted without a DOM. The panel
 * draws the buttons and the menu; what they write is decided here, and the
 * block's lock is judged by the editor's own question when the op is applied.
 *
 * @module layer-row-actions
 */

import {
  findNode,
  hiddenOnDevice,
  setDeviceVisibility,
  type BlockDocument,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./op-vocabulary";

/** The device a row's eye acts on: the site's breakpoints and the one edited. */
export interface EyeDevice {
  readonly breakpoints: BreakpointSet | undefined;
  /** The breakpoint being edited, the one the canvas shows. */
  readonly id: string;
}

/**
 * The op that flips a block's visibility on the device being edited, and on
 * that device only: every other device keeps showing what it showed. `null`
 * for a block the document does not hold.
 *
 * Written through the engine's per-device writer, so the stored values are
 * the fewest that resolve to what the author asked for, read by the cascade
 * the published stylesheet is compiled from. A block left visible everywhere
 * stores no visibility at all, its conditions apart.
 */
export function toggleOnDeviceOp(
  document: BlockDocument,
  id: string,
  device: EyeDevice
): BuilderOp | null {
  const node = findNode(document.nodes, id);
  if (node === undefined) return null;
  const hidden = hiddenOnDevice(node.visibility, device.breakpoints, device.id);
  const next = setDeviceVisibility(
    node.visibility,
    device.breakpoints,
    device.id,
    hidden
  );
  return next === undefined
    ? { kind: "update", id, patch: {}, unset: ["visibility"] }
    : { kind: "update", id, patch: { visibility: next } };
}

/** The verbs a row's keystrokes run. */
export type RowKeyAction = "rename" | "toggle-hidden" | "toggle-lock";

/**
 * The keystrokes, as the menu shows them beside each verb. F2 renames, as in
 * every file and layer tree; the eye and the lock take the chords Figma gives
 * them, since the icons themselves are pointer-only.
 */
export const ROW_KEYS: Readonly<Record<RowKeyAction, string>> = {
  rename: "F2",
  "toggle-hidden": "mod+shift+h",
  "toggle-lock": "mod+shift+l",
};

/**
 * Which row verb a key press asks for, or `null`. `mod` is Command on an
 * Apple keyboard and Control elsewhere, as every editor binding reads it.
 */
export function rowKeyAction(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
  apple: boolean
): RowKeyAction | null {
  if (event.altKey) return null;
  const mod = apple ? event.metaKey : event.ctrlKey;
  if (event.key === "F2" && !mod && !event.shiftKey) return "rename";
  if (!mod || !event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === "h") return "toggle-hidden";
  if (key === "l") return "toggle-lock";
  return null;
}
