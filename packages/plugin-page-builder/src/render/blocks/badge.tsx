import { defineBlock } from "../../core/registry";

import { str } from "./util";

/** A small inline label pill. Ships a soft default style; fully restylable via supports. */
export const badge = defineBlock({
  type: "core/badge",
  version: 1,
  label: "Badge",
  icon: "Tag",
  category: "basic",
  defaultProps: { text: "Badge" },
  contentFields: [
    { name: "text", type: "text", label: "Text", bindable: true },
  ],
  defaultStyle: {
    base: {
      backgroundColor: "#eef2ff",
      color: "#4f46e5",
      padding: { top: "2px", right: "10px", bottom: "2px", left: "10px" },
      borderRadius: "9999px",
      fontSize: "12px",
      display: "inline-block",
    },
  },
  supports: {
    typography: true,
    color: { text: true, background: true },
    border: true,
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <span className={className}>{str(props.text, "Badge")}</span>
  ),
});
