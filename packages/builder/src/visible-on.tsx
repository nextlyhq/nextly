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

export interface VisibleOnProps {
  readonly editor: EditorState;
  readonly nodeId: string;
  /** The site's breakpoints. */
  readonly breakpoints: BreakpointSet | undefined;
  /** The device being edited, marked among the others. */
  readonly editing: string;
  /**
   * Whether `breakpoints` is the site's own set. Until it is, the buttons
   * are held: a change resolved against a stand-in set is stored wrong.
   */
  readonly ready?: boolean;
}

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
  ready = true,
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
  // Held whole when the block's locks refuse the change: the same question
  // the store asks when the press is applied.
  const firstOp = toggleOnDeviceOp(editor.document, nodeId, {
    breakpoints,
    id: devices[0]?.id ?? editing,
  });
  const held =
    !ready ||
    (firstOp !== null && editor.lockRefusalFor([firstOp]) !== undefined);
  const hidden = devices.filter(device => !device.visible);
  const summary = !ready
    ? "Reading the site's breakpoints…"
    : hidden.length === 0
      ? "Shown on every device."
      : hidden.length === devices.length
        ? "Hidden on every device."
        : `Hidden on ${listed(hidden.map(device => device.label))}.`;
  return (
    <div className="nx-inspector__field" data-content-control="visible-on">
      <p className="nx-inspector__field-name" id={labelId}>
        Visible on
      </p>
      <div
        className="nx-style-inspector__toggle nx-visible-on"
        role="group"
        aria-labelledby={labelId}
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
