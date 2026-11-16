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
  // The look is the definition's base styles, in the site's colours: the
  // canvas may draw in a frame that loads no editor stylesheet.
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

/**
 * How the marker looks: one dashed line in the site's own colours. Compiled
 * into the page's sheet with the page, as any block's defaults are, because
 * the canvas may draw the page in a frame of the site's own that loads the
 * site's stylesheet and none of the editor's.
 */
const CONDITION_HIDDEN_BASE_STYLES = {
  base: {
    base: {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: {
        blockStart: "0.375rem",
        blockEnd: "0.375rem",
        inlineStart: "0.625rem",
        inlineEnd: "0.625rem",
      },
      border: {
        width: {
          blockStart: "1px",
          blockEnd: "1px",
          inlineStart: "1px",
          inlineEnd: "1px",
        },
        style: "dashed",
        color: { $token: "color.border-strong" },
      },
      borderRadius: "2px",
      backgroundColor: { $token: "color.surface" },
      color: { $token: "color.muted" },
      // 13px at the page's own scale, over the 12px floor, in the muted
      // colour, which the site's default tokens hold at 4.6:1 on the surface
      // in light and 6.8:1 in dark.
      fontSize: "0.8125rem",
      lineHeight: "1.35",
    },
  },
} as const;

/** The marker's definition: no settings, never offered, never stored. */
const conditionHidden: BlockDefinition<ConditionHiddenProps> = defineBlock({
  name: CONDITION_HIDDEN_TYPE,
  version: 1,
  description: "A block hidden by its conditions, while they are applied.",
  props: {},
  defaultProps: { name: "", reason: "", unchecked: false },
  example: { props: { name: "", reason: "", unchecked: false } },
  baseStyles: CONDITION_HIDDEN_BASE_STYLES,
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
