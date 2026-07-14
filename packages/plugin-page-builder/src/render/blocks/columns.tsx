import { Children } from "react";

import { defineBlock } from "../../core/registry";

import { str } from "./util";

/**
 * A horizontal set of equal-flex columns; each direct child becomes a column.
 * Columns wrap (stack) on narrow viewports. Per-column fixed widths are a refinement.
 */
export const columns = defineBlock({
  type: "core/columns",
  version: 1,
  label: "Columns",
  icon: "Columns",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { gap: "24px", verticalAlign: "stretch" },
  contentFields: [
    { name: "gap", type: "text", label: "Gap", placeholder: "24px" },
    {
      name: "verticalAlign",
      type: "select",
      label: "Vertical align",
      options: ["stretch", "flex-start", "center", "flex-end"].map(v => ({
        value: v,
        label: v,
      })),
    },
  ],
  supports: {
    color: { background: true },
    background: true,
    spacing: true,
    border: true,
    shadow: true,
    dimensions: { minHeight: true },
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, slots, className }) => {
    const gap = str(props.gap, "24px");
    const align = str(props.verticalAlign, "stretch");
    return (
      <div
        className={className}
        style={{
          display: "flex",
          gap,
          alignItems: align,
          flexWrap: "wrap",
        }}
      >
        {Children.map(slots.default, child => (
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>{child}</div>
        ))}
      </div>
    );
  },
});
