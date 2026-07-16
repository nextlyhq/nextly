import { defineBlock } from "../../core/registry";

import { str } from "./util";

const JUSTIFY = ["flex-start", "center", "flex-end", "space-between"];
const ALIGN = ["stretch", "flex-start", "center", "flex-end"];

/** A flex Row/Stack with orientation, wrap, justify and align controls. */
export const row = defineBlock({
  type: "core/row",
  version: 1,
  label: "Row / Stack",
  icon: "Columns",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {
    orientation: "horizontal",
    justify: "flex-start",
    align: "stretch",
    wrap: "wrap",
    gap: "16px",
  },
  contentFields: [
    {
      name: "orientation",
      type: "select",
      label: "Orientation",
      options: [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
      ],
    },
    {
      name: "justify",
      type: "select",
      label: "Justify",
      options: JUSTIFY.map(v => ({ value: v, label: v })),
    },
    {
      name: "align",
      type: "select",
      label: "Align",
      options: ALIGN.map(v => ({ value: v, label: v })),
    },
    {
      name: "wrap",
      type: "select",
      label: "Wrap",
      options: [
        { value: "wrap", label: "Wrap" },
        { value: "nowrap", label: "No wrap" },
      ],
    },
    { name: "gap", type: "text", label: "Gap", placeholder: "16px" },
  ],
  supports: {
    color: { background: true, link: true },
    background: true,
    spacing: true,
    border: true,
    shadow: true,
    dimensions: { minHeight: true },
    position: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, slots, className }) => (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: props.orientation === "vertical" ? "column" : "row",
        justifyContent: JUSTIFY.includes(str(props.justify))
          ? str(props.justify)
          : "flex-start",
        alignItems: ALIGN.includes(str(props.align))
          ? str(props.align)
          : "stretch",
        flexWrap: props.wrap === "nowrap" ? "nowrap" : "wrap",
        gap: str(props.gap, "16px"),
      }}
    >
      {slots.default}
    </div>
  ),
});
