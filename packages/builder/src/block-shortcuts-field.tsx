/**
 * The Section and Button shortcuts, drawn at the top of the Size section: a
 * Section's Height, and a Button's Size and Full width. Each writes the Style
 * value beneath it at the device being edited, which stays editable as itself.
 *
 * @module block-shortcuts-field
 */
import {
  findNode,
  type BreakpointId,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { Switch } from "@nextlyhq/ui";
import * as React from "react";

import {
  BUTTON_BLOCK,
  fullWidthOf,
  heightOf,
  planFullWidth,
  planHeight,
  planSize,
  SECTION_BLOCK,
  sizeOf,
  sizesOffered,
  type HeightChoice,
  type ShortcutAt,
  type SizeChoice,
} from "./block-shortcuts";
import type { EditorState } from "./editor-state";
import type { BuilderOp } from "./ops";
import { SegmentChoices } from "./segment-choices";

const HEIGHT_LABELS: Readonly<Record<HeightChoice, string>> = {
  auto: "Auto",
  screen: "Full screen",
};

const SIZE_LABELS: Readonly<Record<SizeChoice, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

/** A labelled row of choices, with the line that says what they do. */
function ChoiceRow<T extends string>({
  label,
  options,
  on,
  labels,
  hint,
  onChoose,
}: {
  label: string;
  options: readonly T[];
  on: T | undefined;
  labels: Readonly<Record<T, string>>;
  hint: string;
  onChoose: (choice: T) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  return (
    <>
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          {label}
        </span>
        <SegmentChoices
          options={options}
          on={on}
          labels={labels}
          labelId={labelId}
          onChoose={onChoose}
        />
      </div>
      <p className="nx-inspector__note">{hint}</p>
    </>
  );
}

export function BlockShortcutsControl({
  editor,
  nodeId,
  state,
  breakpoint,
}: {
  editor: EditorState;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
}): React.JSX.Element | null {
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  const at: ShortcutAt = { state, breakpoint };
  const apply = (op: BuilderOp | null) => {
    if (op !== null) editor.apply(op);
  };
  if (node.type === SECTION_BLOCK) {
    return (
      <div className="nx-block-shortcuts" data-control="section-height">
        <ChoiceRow
          label="Height"
          options={["auto", "screen"] as const}
          on={heightOf(node, at)}
          labels={HEIGHT_LABELS}
          hint="At least the screen's height; grows with its content."
          onChoose={choice => apply(planHeight(node, choice, at))}
        />
      </div>
    );
  }
  if (node.type !== BUTTON_BLOCK) return null;
  const size = sizeOf(node, at);
  return (
    <div className="nx-block-shortcuts" data-control="button-size">
      {sizesOffered(node) ? (
        <ChoiceRow
          label="Size"
          options={["small", "medium", "large"] as const}
          on={size}
          labels={SIZE_LABELS}
          hint={
            size === undefined
              ? "Custom: the padding or text size below is set another way."
              : "Sets the padding and text size together."
          }
          onChoose={choice => apply(planSize(node, choice, at))}
        />
      ) : null}
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name">Full width</span>
        <Switch
          aria-label="Full width"
          checked={fullWidthOf(node, at)}
          onCheckedChange={on => apply(planFullWidth(node, on, at))}
        />
      </div>
      <p className="nx-inspector__note">
        As wide as its container, here and below.
      </p>
    </div>
  );
}
