import { defineBlock } from "../../core/registry";

// Grid layout: the column count + gap are driven by the `columns`/`gap` content fields and
// applied as an inline grid style (safe: CSS values in a style object are never executed).
// Colours/spacing/etc. still come from the style compiler via `className`.
interface GridProps {
  columns?: number;
  gap?: string;
}

export const grid = defineBlock<GridProps>({
  type: "core/grid",
  version: 1,
  label: "Grid",
  icon: "LayoutGrid",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { columns: 2, gap: "16px" },
  contentFields: [
    { name: "columns", type: "number", label: "Columns" },
    { name: "gap", type: "text", label: "Gap", placeholder: "16px" },
  ],
  supports: {
    color: { background: true },
    background: true,
    spacing: true,
    border: true,
    shadow: true,
    dimensions: { minHeight: true },
  },
  render: ({ props, slots, className }) => {
    const columns =
      typeof props.columns === "number" && props.columns > 0
        ? Math.min(props.columns, 12)
        : 2;
    const gap = typeof props.gap === "string" ? props.gap : "16px";
    return (
      <div
        className={className}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap,
        }}
      >
        {slots.default}
      </div>
    );
  },
});
