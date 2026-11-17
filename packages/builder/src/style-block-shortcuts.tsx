"use client";

/**
 * The fields a block adds to its own Style sections: its shortcuts, and the
 * presets drawn over a section.
 *
 * @module style-block-shortcuts
 */
import { findNode, type StyleValue } from "@nextlyhq/blocks-engine";
import * as React from "react";

import {
  planSpacerHeight,
  reachingBeneath,
  SPACER_BLOCK,
} from "./block-shortcuts";
import {
  BlockShortcutsControl,
  MinHeightPresets,
} from "./block-shortcuts-field";
import { useCanvasTokenMode } from "./canvas/prefers-dark";
import { SegmentChoices } from "./segment-choices";
import {
  identityOfKey,
  offeredPreset,
  presetKey,
  presetLabels,
  spacingPresets,
} from "./spacing-presets";
import type { StyleControl } from "./style-controls";
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

/**
 * A Spacer's Height presets, over its Height field: the site's spacing
 * variables, smallest first, as a spacing side's popover offers them, so a
 * space between blocks is chosen from the same scale as a padding or a gap.
 * Only for the block itself. Held, as the section's other fields are, by the
 * fieldset a locked block's section is drawn in.
 */
export function SpacerHeightPresets({
  surroundings,
  control,
  stored,
}: {
  surroundings: StyleFieldSurroundings;
  /** The Height field's control, whose variables the presets are. */
  control: StyleControl | undefined;
  /** The height stored at the edited state and device. */
  stored: StyleValue | undefined;
}): React.JSX.Element | null {
  const target = React.useContext(StyleTargetContext);
  const mode = useCanvasTokenMode();
  const id = React.useId();
  const { editor, nodeId, state, breakpoint, tokens } = surroundings;
  const node = findNode(editor.document.nodes, nodeId);
  if (target.kind !== "block" || node?.type !== SPACER_BLOCK) return null;
  if (control === undefined) return null;
  const presets = spacingPresets(control, tokens, mode);
  if (presets.length === 0) return null;
  const at = { state, breakpoint };
  return (
    <div className="nx-block-shortcuts" data-control="spacer-height">
      <span id={`${id}-presets`} className="nx-inspector__field-name">
        Presets
      </span>
      <SegmentChoices
        options={presets.map(preset => presetKey(preset.identity))}
        on={offeredPreset(stored, presets)}
        labels={presetLabels(presets)}
        labelId={`${id}-presets`}
        onChoose={choice => {
          const identity = identityOfKey(choice);
          if (identity === undefined) return;
          const op = planSpacerHeight(node, identity, at);
          if (op !== null) editor.apply(op);
        }}
      />
    </div>
  );
}
