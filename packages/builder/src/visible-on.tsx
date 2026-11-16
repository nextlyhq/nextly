"use client";

/**
 * "Visible on" in the Content tab: which devices a block shows on, and a
 * press to show or hide it on any one of them.
 *
 * Each device shows its RESOLVED state, the one a visitor on that device
 * gets, read through the engine's cascade rather than from the stored
 * values: a block hidden from Desktop down is hidden on Tablet too, though
 * nothing is stored for Tablet. A press changes that device alone, as the
 * Layers eye does, so every other device keeps what it showed.
 *
 * The state is said in words below the buttons as well as by each button's
 * pressed state, so it is never carried by colour alone.
 *
 * @module visible-on
 */

import {
  deviceVisibility,
  findNode,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { deviceOptions, tierIcon } from "./breakpoint-switcher";
import type { EditorState } from "./editor-state";
import { toggleOnDeviceOp } from "./layer-row-actions";

/** Whether the site's breakpoints are its own set yet, as the editor reads it. */
export type BreakpointsStatus = "loading" | "unavailable" | "ready";

export interface VisibleOnProps {
  readonly editor: EditorState;
  readonly nodeId: string;
  /** The site's breakpoints. */
  readonly breakpoints: BreakpointSet | undefined;
  /** The device being edited, marked among the others. */
  readonly editing: string;
  /**
   * Whether `breakpoints` is the site's own set: while it is being read, or
   * when the read failed, the buttons are held, since a change resolved
   * against a stand-in set is stored wrong, and the sentence says which.
   */
  readonly status?: BreakpointsStatus;
  /**
   * Why a lock holds the block's design, which includes where it shows, or
   * `undefined` while nothing does: the inspector's own reading, which holds
   * every other design control.
   */
  readonly heldBy?: string | undefined;
  /** The id of the element saying why, which held buttons point to. */
  readonly reasonId?: string;
}

/** What the control says while it cannot be used, by why. */
const STATUS_WORDS: Readonly<
  Record<Exclude<BreakpointsStatus, "ready">, string>
> = {
  loading: "Reading the site's breakpoints…",
  unavailable:
    "The site's breakpoints could not be read, so where this block shows can't be changed here. Reload to try again.",
};

/** "Mobile", "Tablet and Mobile", "Desktop, Tablet and Mobile". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function VisibleOn({
  editor,
  nodeId,
  breakpoints,
  editing,
  status = "ready",
  heldBy,
  reasonId,
}: VisibleOnProps): React.JSX.Element | null {
  const labelId = React.useId();
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  const states = new Map(
    deviceVisibility(node.visibility, breakpoints).map(device => [
      device.id,
      device.visible,
    ])
  );
  const devices = deviceOptions(breakpoints).map(option => ({
    ...option,
    visible: states.get(option.id) ?? true,
  }));
  // Held whole while a lock holds the block's design, as every other design
  // control is, and until the site's breakpoints are known.
  const held = status !== "ready" || heldBy !== undefined;
  const hidden = devices.filter(device => !device.visible);
  const summary =
    status !== "ready"
      ? STATUS_WORDS[status]
      : hidden.length === 0
        ? "Shown on every device."
        : hidden.length === devices.length
          ? "Hidden on every device."
          : `Hidden on ${listed(hidden.map(device => device.label))}.`;
  return (
    <div className="nx-inspector__field" data-visible-on="">
      <p className="nx-inspector__field-name" id={labelId}>
        Visible on
      </p>
      <div
        className="nx-style-inspector__toggle nx-visible-on"
        role="group"
        aria-labelledby={labelId}
        {...(heldBy === undefined || reasonId === undefined
          ? {}
          : { "aria-describedby": reasonId })}
      >
        {devices.map(device => {
          const Icon = tierIcon(device.preview);
          return (
            <button
              key={device.id}
              type="button"
              aria-pressed={device.visible}
              aria-label={device.label}
              title={`${device.label}: ${device.visible ? "shown" : "hidden"}`}
              disabled={held}
              {...(device.id === editing ? { "data-editing": "" } : {})}
              onClick={() => {
                const op = toggleOnDeviceOp(editor.document, nodeId, {
                  breakpoints,
                  id: device.id,
                });
                if (op !== null) editor.apply(op);
              }}
            >
              <Icon className="nx-visible-on__icon" />
            </button>
          );
        })}
      </div>
      <p className="nx-inspector__note" aria-live="polite">
        {summary}
      </p>
    </div>
  );
}
