/**
 * A List's own marker, said under "List as": a list that stores a
 * `list-style-type` of its own draws that marker, not the bullets or numbers
 * its kind names, so the kind's choice would read as a promise the page does
 * not keep. The note says the marker is custom, and Clear removes it, at
 * every state and device it is stored at, so the kind decides again.
 *
 * The marker itself is a CSS detail, added and changed from "Add CSS
 * property" in Style; this is only where Content says it is there.
 *
 * @module list-marker-note
 */
import type {
  BlockNode,
  BreakpointId,
  StyleState,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { chainedStyleOp } from "../../columns-layout";
import type { BuilderOp } from "../../op-vocabulary";
import { readStyleValue } from "../../style-values";

/** The block a marker note belongs to. */
const LIST_BLOCK = "core/list";

/** The style property a List's own marker is stored under. */
const MARKER = "listStyleType";

/** Each state and device a List stores a marker of its own at. */
export function customMarkerAt(node: BlockNode): readonly {
  readonly state: StyleState;
  readonly breakpoint: BreakpointId;
}[] {
  const styles = node.styles;
  if (styles === undefined || styles === null) return [];
  return Object.entries(styles).flatMap(([state, devices]) =>
    typeof devices === "object" && devices !== null
      ? Object.keys(devices).flatMap(breakpoint => {
          const at = {
            state: state as StyleState,
            breakpoint,
          };
          return readStyleValue(styles, {
            ...at,
            property: MARKER,
            path: [],
          }) === undefined
            ? []
            : [at];
        })
      : []
  );
}

/** One op clearing the List's own marker wherever it is stored, or none. */
export function planClearMarker(node: BlockNode): BuilderOp | null {
  return chainedStyleOp(
    node,
    customMarkerAt(node).map(at => ({
      address: { ...at, property: MARKER, path: [] },
      value: null,
    }))
  );
}

/** "Custom marker · Clear", under a List's "List as", while it has one. */
export function ListMarkerNote({
  node,
  disabled,
  onApply,
}: {
  node: BlockNode | undefined;
  /** Whether the block's styles may not be changed here, as under a lock. */
  disabled: boolean;
  onApply: (op: BuilderOp) => boolean;
}): React.JSX.Element | null {
  if (node?.type !== LIST_BLOCK || customMarkerAt(node).length === 0) {
    return null;
  }
  return (
    <p className="nx-settings-note">
      Custom marker ·{" "}
      <button
        type="button"
        className="nx-settings-note__link"
        disabled={disabled}
        aria-label="Clear the custom marker"
        onClick={() => {
          const op = planClearMarker(node);
          if (op !== null) onApply(op);
        }}
      >
        Clear
      </button>
    </p>
  );
}
