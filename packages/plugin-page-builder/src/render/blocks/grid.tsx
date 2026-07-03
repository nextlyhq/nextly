import { defineBlock } from "../../core/registry";

// Grid layout (display:grid, grid-template-columns, gap) is emitted by the style
// compiler from the node's style; the editor writes those from `columns`/`gap`. The
// renderer only provides the grid container element + its slot.
export const grid = defineBlock({
  type: "core/grid",
  version: 1,
  label: "Grid",
  icon: "LayoutGrid",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { columns: 2, gap: "16px" },
  render: ({ slots, className }) => (
    <div className={className}>{slots.default}</div>
  ),
});
