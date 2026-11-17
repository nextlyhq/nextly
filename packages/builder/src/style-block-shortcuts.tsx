"use client";

/**
 * The fields a block adds to its own Style sections: its shortcuts, and the
 * presets drawn over a section.
 *
 * @module style-block-shortcuts
 */
import * as React from "react";

import { reachingBeneath } from "./block-shortcuts";
import {
  BlockShortcutsControl,
  MinHeightPresets,
} from "./block-shortcuts-field";
import {
  StyleTargetContext,
  TokenPrefixContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";

/**
 * A Section's Height and a Button's Size and Full width, at the top of its
 * Size section. Only for the block itself: a shared style's values are not
 * the block's to size.
 */
export function BlockShortcutsFields({
  surroundings,
  minHeightDrawn,
}: {
  surroundings: StyleFieldSurroundings;
  /** Whether the Min height field is drawn, which then carries its presets. */
  minHeightDrawn: boolean;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const tokenPrefix = React.useContext(TokenPrefixContext);
  if (target.kind !== "block") return null;
  const where = shortcutWhere(surroundings, tokenPrefix);
  return (
    <>
      <BlockShortcutsControl {...where} />
      {minHeightDrawn ? null : <MinHeightPresets {...where} over={false} />}
    </>
  );
}

/** A Section's Min height presets, over the Min height field it presets. */
export function BlockPresetsOver({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const tokenPrefix = React.useContext(TokenPrefixContext);
  if (target.kind !== "block") return null;
  return (
    <MinHeightPresets {...shortcutWhere(surroundings, tokenPrefix)} over />
  );
}

/**
 * Where a shortcut writes, and what reaches it from elsewhere: the value the
 * panel's own provenance reports as inherited, the one ranking of the trace.
 */
function shortcutWhere(
  surroundings: StyleFieldSurroundings,
  tokenPrefix: string
) {
  return {
    editor: surroundings.editor,
    nodeId: surroundings.nodeId,
    state: surroundings.state,
    breakpoint: surroundings.breakpoint,
    tokenPrefix,
    reaching: reachingBeneath(cssProperty =>
      surroundings.provenanceOf({
        kind: "cssValue",
        cssProperty,
        tokenKinds: [],
      })
    ),
  };
}
