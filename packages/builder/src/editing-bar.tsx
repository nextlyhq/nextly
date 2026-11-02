"use client";

/**
 * The "what you're editing" bar at the top of the Style tab.
 *
 * Says in words what the next edit changes before any control does: which
 * target (this block, or a shared style and how far it reaches), on which
 * device, in which state. Words and not colour alone, so it reads the same to
 * everyone; the state's control sits in the bar because choosing the state is
 * choosing what the controls below write.
 *
 * The device and the state are the canvas's own values, handed down, never a
 * second copy kept here: the bar describes what the canvas is showing.
 *
 * @module editing-bar
 */

import type { StyleState } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { stateLabel } from "./state-switcher";

/**
 * What a style edit writes to.
 *
 * A typed model rather than a flag, because the shared-style target carries
 * what the bar must say about it: its name and how many blocks it reaches.
 * Only `block` is reachable today.
 */
export type EditTarget =
  | { readonly kind: "block" }
  | { readonly kind: "shared"; readonly name: string; readonly reach: string };

export interface EditingBarProps {
  readonly target: EditTarget;
  /** The device being edited, by name: "Desktop", "Tablet". */
  readonly device: string;
  /** The state being edited. */
  readonly state: StyleState;
  /**
   * The control that changes the state, when the host can carry the choice to
   * its canvas. Without it the bar names the state and offers no change.
   */
  readonly stateControl?: React.ReactNode;
}

export function EditingBar({
  target,
  device,
  state,
  stateControl,
}: EditingBarProps): React.JSX.Element {
  return (
    <section className="nx-editing-bar" aria-label="What you're editing">
      <dl className="nx-editing-bar__facts">
        <div className="nx-editing-bar__fact">
          <dt>Editing</dt>
          <dd data-edit-target={target.kind}>
            {target.kind === "block"
              ? "This block"
              : `${target.name} · ${target.reach}`}
          </dd>
        </div>
        <div className="nx-editing-bar__fact">
          <dt>Device</dt>
          <dd data-edit-device="">{device}</dd>
        </div>
        <div className="nx-editing-bar__fact">
          <dt>State</dt>
          <dd data-edit-state={state}>{stateLabel(state)}</dd>
        </div>
      </dl>
      {stateControl}
    </section>
  );
}
