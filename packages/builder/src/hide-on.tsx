"use client";

/**
 * "Hide on" in the Advanced tab: one toggle per device the site defines, each
 * with its icon and its name, pressed where the block is hidden; and the line
 * at the top of every tab saying where a block is hidden.
 *
 * Each device shows its RESOLVED state, the one a visitor on that device
 * gets, read through the engine's cascade rather than from the stored
 * values: a block hidden from Desktop down is hidden on Tablet too, though
 * nothing is stored for Tablet. A press changes that device alone, as the
 * Layers eye does, so every other device keeps what it showed: hiding on
 * Desktop leaves Tablet and Mobile showing, which the line under the toggles
 * says.
 *
 * @module hide-on
 */

import { findNode, type BreakpointSet } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { hideOnWrites } from "./code-hints";
import { CssHint } from "./css-hint";
import type { EditorState } from "./editor-state";
import { withSectionFold } from "./panel-folds";
import { usePanelFolds } from "./panel-folds-context";
import {
  deviceStates,
  hiddenDeviceNames,
  listedNames,
  toggleOnDeviceOp,
} from "./panels/layers/layer-row-actions";
import { tierIcon } from "./shell/breakpoint-switcher";

/** Whether the site's breakpoints are its own set yet, as the editor reads it. */
export type BreakpointsStatus = "loading" | "unavailable" | "ready";

/** The Advanced section Hide on is drawn in, which "Change" opens. */
const HIDE_ON_SECTION = "Visibility";

/** Marks the Hide on field, which "Change" moves focus into. */
const HIDE_ON_ATTRIBUTE = "data-hide-on";

export interface HideOnProps {
  readonly editor: EditorState;
  readonly nodeId: string;
  /** The site's breakpoints. */
  readonly breakpoints: BreakpointSet | undefined;
  /** The device being edited, marked among the others. */
  readonly editing: string;
  /**
   * Whether `breakpoints` is the site's own set: while it is being read, or
   * when the read failed, the toggles are held, since a change resolved
   * against a stand-in set is stored wrong, and a sentence says which.
   */
  readonly status?: BreakpointsStatus;
  /**
   * Why a lock holds the block's design, which includes where it shows, or
   * `undefined` while nothing does: the inspector's own reading, which holds
   * every other design control.
   */
  readonly heldBy?: string | undefined;
  /** The id of the element saying why, which held toggles point to. */
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

/** Said under the toggles: a press hides that device alone. */
const ONLY_THOSE_PICKED =
  "Hides only on the devices you pick, not smaller ones.";

export function HideOn({
  editor,
  nodeId,
  breakpoints,
  editing,
  status = "ready",
  heldBy,
  reasonId,
}: HideOnProps): React.JSX.Element | null {
  const labelId = React.useId();
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  const devices = deviceStates(node.visibility, breakpoints);
  // Held whole while a lock holds the block's design, as every other design
  // control is, and until the site's breakpoints are known.
  const held = status !== "ready" || heldBy !== undefined;
  return (
    <div className="nx-inspector__field" {...{ [HIDE_ON_ATTRIBUTE]: "" }}>
      <p className="nx-inspector__field-name" id={labelId}>
        Hide on
      </p>
      <div
        className="nx-hide-on"
        role="group"
        aria-labelledby={labelId}
        {...(heldBy === undefined || reasonId === undefined
          ? {}
          : { "aria-describedby": reasonId })}
      >
        {devices.map(device => {
          const Icon = tierIcon(device.preview);
          return (
            <CssHint key={device.id} writes={hideOnWrites(device.widths)}>
              <button
                type="button"
                aria-pressed={device.hidden}
                aria-label={`Hide on ${device.label}`}
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
                <Icon className="nx-hide-on__icon" />
                <span className="nx-hide-on__name">{device.label}</span>
              </button>
            </CssHint>
          );
        })}
      </div>
      <p className="nx-inspector__note" aria-live="polite">
        {status === "ready" ? ONLY_THOSE_PICKED : STATUS_WORDS[status]}
      </p>
    </div>
  );
}

/**
 * The line at the top of a tab while the block is hidden on any device:
 * "Hidden on Mobile. Visitors on that device won't see it." From a tab other
 * than Advanced it ends in "Change", which takes the author to Hide on.
 * Nothing while the block shows everywhere.
 */
export function HiddenStatus({
  editor,
  nodeId,
  breakpoints,
  onChoose,
}: {
  readonly editor: EditorState;
  readonly nodeId: string;
  readonly breakpoints: BreakpointSet | undefined;
  /**
   * Show another tab, for "Change"; absent on the Advanced tab, where Hide
   * on is already in view.
   */
  readonly onChoose?: ((tab: "advanced") => void) | undefined;
}): React.JSX.Element | null {
  const node = findNode(editor.document.nodes, nodeId);
  const toHideOn = useToHideOn(onChoose);
  if (node === undefined) return null;
  const names = hiddenDeviceNames(node.visibility, breakpoints);
  if (names.length === 0) return null;
  const visitors = names.length === 1 ? "that device" : "those devices";
  return (
    <p className="nx-settings-note nx-hidden-status">
      {`Hidden on ${listedNames(names)}. Visitors on ${visitors} won't see it.`}
      {toHideOn === undefined ? null : (
        <>
          {" "}
          <button
            type="button"
            className="nx-settings-note__link"
            onClick={toHideOn}
          >
            Change
          </button>
        </>
      )}
    </p>
  );
}

/**
 * "Change": the Advanced tab shown, its Visibility section opened, and focus
 * on Hide on's first toggle once it is on screen. `undefined` where there is
 * no other tab to go from.
 */
function useToHideOn(
  onChoose: ((tab: "advanced") => void) | undefined
): ((event: React.MouseEvent<HTMLElement>) => void) | undefined {
  const { change } = usePanelFolds();
  if (onChoose === undefined) return undefined;
  return event => {
    // Read now: the tab holding this link may be gone once Advanced shows.
    const panel = event.currentTarget.closest(".nx-inspector");
    change(folds => withSectionFold(folds, "advanced", HIDE_ON_SECTION, true));
    onChoose("advanced");
    // A frame later, once the tab and the section are drawn open.
    requestAnimationFrame(() => {
      panel
        ?.querySelector<HTMLElement>(`[${HIDE_ON_ATTRIBUTE}] button`)
        ?.focus();
    });
  };
}
