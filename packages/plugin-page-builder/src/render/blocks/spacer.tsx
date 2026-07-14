import { defineBlock } from "../../core/registry";

import { str } from "./util";

/** An empty, sized vertical gap. Height is authored; responsive height via style. */
export const spacer = defineBlock({
  type: "core/spacer",
  version: 1,
  label: "Spacer",
  icon: "Square",
  category: "layout",
  defaultProps: { height: "40px" },
  contentFields: [
    { name: "height", type: "text", label: "Height", placeholder: "40px" },
  ],
  supports: { visibility: true, customCss: true, customAttributes: true },
  render: ({ props, className }) => (
    <div
      className={className}
      aria-hidden
      style={{ height: str(props.height, "40px") }}
    />
  ),
});
