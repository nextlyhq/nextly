import { defineBlock } from "../../core/registry";

import { str } from "./util";

const STYLES = ["solid", "dashed", "dotted", "double"];

/** A horizontal rule with authorable style, weight, color, width and alignment. */
export const divider = defineBlock({
  type: "core/divider",
  version: 1,
  label: "Divider",
  icon: "Minus",
  category: "layout",
  defaultProps: {
    lineStyle: "solid",
    weight: "1px",
    color: "#e5e7eb",
    width: "100%",
    align: "center",
  },
  contentFields: [
    {
      name: "lineStyle",
      type: "select",
      label: "Style",
      options: STYLES.map(s => ({ value: s, label: s })),
    },
    { name: "weight", type: "text", label: "Weight", placeholder: "1px" },
    { name: "color", type: "text", label: "Color", placeholder: "#e5e7eb" },
    { name: "width", type: "text", label: "Width", placeholder: "100%" },
    {
      name: "align",
      type: "select",
      label: "Align",
      options: ["left", "center", "right"].map(a => ({ value: a, label: a })),
    },
  ],
  supports: { spacing: true, visibility: true, customCss: true },
  render: ({ props, className }) => {
    const lineStyle = STYLES.includes(str(props.lineStyle))
      ? str(props.lineStyle)
      : "solid";
    const weight = str(props.weight, "1px");
    const color = str(props.color, "#e5e7eb");
    const width = str(props.width, "100%");
    const align =
      props.align === "left" || props.align === "right"
        ? props.align
        : "center";
    const margin =
      align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";
    return (
      <hr
        className={className}
        style={{
          border: 0,
          borderTop: `${weight} ${lineStyle} ${color}`,
          width,
          margin,
        }}
      />
    );
  },
});
