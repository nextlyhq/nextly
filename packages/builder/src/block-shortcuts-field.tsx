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
  type Reaching,
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

/**
 * A labelled row of choices, with the line that says what they do. Unlabelled
 * on screen where it stands over the field it presets, which carries the
 * label; its name is still read.
 */
function ChoiceRow<T extends string>({
  label,
  shownLabel = true,
  options,
  on,
  labels,
  hint,
  onChoose,
}: {
  label: string;
  shownLabel?: boolean;
  options: readonly T[];
  on: T | undefined;
  labels: Readonly<Record<T, string>>;
  /** What the choices do, or none where the field beneath already says. */
  hint?: string | undefined;
  onChoose: (choice: T) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  return (
    <>
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name" id={labelId}>
          {shownLabel ? label : <span className="sr-only">{label}</span>}
        </span>
        <SegmentChoices
          options={options}
          on={on}
          labels={labels}
          labelId={labelId}
          onChoose={onChoose}
        />
      </div>
      {hint === undefined ? null : <p className="nx-inspector__note">{hint}</p>}
    </>
  );
}

/** Where a shortcut control writes, and from what. */
interface ShortcutProps {
  editor: EditorState;
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  /** What reaches the edited address from elsewhere, as the cascade says. */
  reaching?: Reaching | undefined;
}

/**
 * A Section's Min height presets, Auto and Full screen: on the Min height
 * row, as a row over its input where that field is drawn (`over`), else as
 * the row itself, named Min height, until a value draws the field.
 */
export function MinHeightPresets({
  editor,
  nodeId,
  state,
  breakpoint,
  reaching,
  over,
}: ShortcutProps & { over: boolean }): React.JSX.Element | null {
  const node = findNode(editor.document.nodes, nodeId);
  if (node?.type !== SECTION_BLOCK) return null;
  const at: ShortcutAt = { state, breakpoint };
  return (
    <div className="nx-block-shortcuts" data-control="section-height">
      <ChoiceRow
        label={over ? "Min height presets" : "Min height"}
        shownLabel={!over}
        options={["auto", "screen"] as const}
        on={heightOf(node, at, reaching)}
        labels={HEIGHT_LABELS}
        // Over the field, the value beneath says what Full screen wrote, and a
        // line between them would part the presets from the field they set.
        hint={
          over
            ? undefined
            : "Full screen: at least the screen's height, growing with its content."
        }
        onChoose={choice => {
          const op = planHeight(node, choice, at, reaching);
          if (op !== null) editor.apply(op);
        }}
      />
    </div>
  );
}

/** A Button's Size and Full width, at the top of its Size section. */
export function BlockShortcutsControl({
  editor,
  nodeId,
  state,
  breakpoint,
  reaching,
}: ShortcutProps): React.JSX.Element | null {
  const node = findNode(editor.document.nodes, nodeId);
  if (node === undefined) return null;
  const at: ShortcutAt = { state, breakpoint };
  const apply = (op: BuilderOp | null) => {
    if (op !== null) editor.apply(op);
  };
  if (node.type !== BUTTON_BLOCK) return null;
  const size = sizeOf(node, at, reaching);
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
          onChoose={choice => apply(planSize(node, choice, at, reaching))}
        />
      ) : null}
      <div className="nx-inspector__field">
        <span className="nx-inspector__field-name">Full width</span>
        <Switch
          aria-label="Full width"
          checked={fullWidthOf(node, at, reaching)}
          onCheckedChange={on => apply(planFullWidth(node, on, at, reaching))}
        />
      </div>
      <p className="nx-inspector__note">
        As wide as its container, here and below.
      </p>
    </div>
  );
}
