import { defineBlock } from "../../core/registry";

/**
 * Query Loop block (spec §10). At production render, RenderNode intercepts this type and
 * renders it data-driven via QueryLoop. This `render` is the DESIGN-TIME preview used by
 * the editor canvas (no data available there): it shows the template slot once.
 */
export const queryLoop = defineBlock({
  type: "core/query-loop",
  version: 1,
  label: "Query Loop",
  icon: "Repeat",
  category: "dynamic",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { collection: "", sort: "", limit: 10 },
  contentFields: [
    {
      name: "collection",
      type: "text",
      label: "Collection slug",
      placeholder: "e.g. posts",
    },
    { name: "sort", type: "text", label: "Sort", placeholder: "-createdAt" },
    { name: "limit", type: "number", label: "Limit" },
  ],
  styleControls: [
    { control: "spacing", styleKey: "padding", label: "Padding" },
    { control: "spacing", styleKey: "margin", label: "Margin" },
  ],
  render: ({ slots, className }) => (
    <div className={className} data-nx-query-loop="preview">
      {slots.default}
    </div>
  ),
});
