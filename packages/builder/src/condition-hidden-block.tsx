/**
 * The marker a block hidden by its conditions is drawn as on the canvas, while
 * conditions are applied: one dashed line naming the block and why a visitor
 * doesn't see it, in the block's place.
 *
 * An editor-only block definition, known only to the canvas's renderer and
 * never stored, so the renderer draws it with the block's own id and the
 * canvas selects, hit-tests and outlines it as the block it stands for. Its
 * root is a plain element, which is what the renderer marks with that id.
 *
 * @module condition-hidden-block
 */
import {
  CONDITION_HIDDEN_TYPE,
  defineBlock,
  type BlockDefinition,
  type BlockRenderArgs,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver } from "@nextlyhq/blocks-react";
import { AlertCircle, EyeOff } from "lucide-react";
import type { ReactElement } from "react";

import type { ConditionHiddenProps } from "./applied-conditions";

/** One hidden block's line: its name, then why it is hidden. */
function renderConditionHidden({
  props,
  className,
}: BlockRenderArgs<ConditionHiddenProps>): ReactElement {
  // Read as stored data, since a marker is a node like any other on its way
  // through the renderer.
  const name = typeof props.name === "string" ? props.name : "";
  const reason = typeof props.reason === "string" ? props.reason : "";
  const unchecked = props.unchecked === true;
  const Icon = unchecked ? AlertCircle : EyeOff;
  return (
    <div
      className={["nx-condition-hidden", className].filter(Boolean).join(" ")}
      data-unchecked={unchecked ? "" : undefined}
    >
      <Icon aria-hidden="true" size={14} />
      <span>
        <b>{name}</b> · {reason}
      </span>
    </div>
  );
}

/** The marker's definition: no settings, nothing to style, never offered. */
const conditionHidden: BlockDefinition<ConditionHiddenProps> = defineBlock({
  name: CONDITION_HIDDEN_TYPE,
  version: 1,
  description: "A block hidden by its conditions, while they are applied.",
  props: {},
  defaultProps: { name: "", reason: "", unchecked: false },
  example: { props: { name: "", reason: "", unchecked: false } },
  render: renderConditionHidden,
});

/**
 * The blocks the canvas draws with, the hidden-block marker among them. Any
 * other type is answered as the resolver given answers it.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function withConditionHiddenBlock(blocks: BlockResolver): BlockResolver {
  return {
    get: type =>
      type === CONDITION_HIDDEN_TYPE ? conditionHidden : blocks.get(type),
  };
}
