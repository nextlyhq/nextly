"use client";

/**
 * The fields a block adds to its own Style sections: the columns layout over
 * its template, its shortcuts, and the presets drawn over a section.
 *
 * @module style-block-shortcuts
 */
import {
  isStyleLeaf,
  STYLE_CATALOG,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import { reachingBeneath } from "./block-shortcuts";
import {
  BlockShortcutsControl,
  MinHeightPresets,
} from "./block-shortcuts-field";
import { COLUMNS_ROW } from "./columns-layout";
import { ColumnsLayoutControl } from "./columns-layout-field";
import {
  type ProvenanceOf,
  StyleTargetContext,
  TokenPrefixContext,
  type StyleFieldSurroundings,
  AppliedAtTier,
} from "./style-field-surroundings";

/**
 * A Columns row's layout tiles and stacking, at the top of its Layout
 * section. Only for the row itself: a shared style's values reach many rows,
 * and its tiles would add or remove columns in none of them.
 */
export function ColumnsLayoutFields({
  surroundings,
}: {
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const applied = React.useContext(AppliedAtTier);
  if (
    target.kind !== "block" ||
    surroundings.editing.blockType !== COLUMNS_ROW
  ) {
    return null;
  }
  return (
    <ColumnsLayoutControl
      editor={surroundings.editor}
      nodeId={surroundings.nodeId}
      state={surroundings.state}
      breakpoint={surroundings.breakpoint}
      breakpoints={surroundings.breakpoints}
      inherited={reachingLayout(surroundings.provenanceOf)}
      applied={applied}
    />
  );
}

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

/** The catalog's leaf for a row's column template, which the trace records. */
const TEMPLATE_LEAF: StyleLeaf | undefined = (() => {
  const shape = STYLE_CATALOG.find(
    entry => entry.property === "gridTemplateColumns"
  )?.shape;
  return shape !== undefined && isStyleLeaf(shape) ? shape : undefined;
})();

/**
 * The column template reaching the row from elsewhere (a wider device, a
 * shared style it wears, another state), as the cascade the dots read
 * answers it: one reading of the cascade, never a second walk of it.
 */
function reachingLayout(provenanceOf: ProvenanceOf): string | undefined {
  const answer =
    TEMPLATE_LEAF === undefined ? undefined : provenanceOf(TEMPLATE_LEAF);
  return answer?.provenance.kind === "inherited"
    ? answer.provenance.entry.value
    : undefined;
}
