import { defineBlock } from "../../core/registry";

// Grid layout: the column count + gap are driven by the `columns`/`gap` content fields and
// applied as an inline grid style (safe: CSS values in a style object are never executed).
// Colours/spacing/etc. still come from the style compiler via `className`.
interface GridProps {
  columns?: number;
  gap?: string;
  mode?: string;
  minColWidth?: string;
}

const CSS_LEN = /^\d+(?:\.\d+)?(px|rem|em|%|vw|vh|ch)$/;

export const grid = defineBlock<GridProps>({
  type: "core/grid",
  version: 1,
  label: "Grid",
  icon: "LayoutGrid",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {
    columns: 2,
    gap: "16px",
    mode: "manual",
    minColWidth: "240px",
  },
  contentFields: [
    {
      name: "mode",
      type: "select",
      label: "Grid item position",
      options: [
        { value: "manual", label: "Manual (column count)" },
        { value: "auto", label: "Auto (min column width)" },
      ],
    },
    { name: "columns", type: "number", label: "Columns (manual)" },
    {
      name: "minColWidth",
      type: "text",
      label: "Min column width (auto)",
      placeholder: "240px",
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
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, slots, className }) => {
    const gap = typeof props.gap === "string" ? props.gap : "16px";
    const auto = props.mode === "auto";
    const minW =
      typeof props.minColWidth === "string" && CSS_LEN.test(props.minColWidth)
        ? props.minColWidth
        : "240px";
    const columns =
      typeof props.columns === "number" && props.columns > 0
        ? Math.min(props.columns, 12)
        : 2;
    const gridTemplateColumns = auto
      ? `repeat(auto-fill, minmax(${minW}, 1fr))`
      : `repeat(${columns}, minmax(0, 1fr))`;
    return (
      <div
        className={className}
        style={{ display: "grid", gridTemplateColumns, gap }}
      >
        {slots.default}
      </div>
    );
  },
});
