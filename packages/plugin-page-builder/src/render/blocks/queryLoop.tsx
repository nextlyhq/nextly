import { defineBlock } from "../../core/registry";
import { loopGridStyle } from "../query/grid";

/**
 * Query Loop block (spec §10/§5). At production render, RenderNode intercepts this type and
 * renders it data-driven via QueryLoop. The editor uses a dedicated settings panel + a live
 * sample-data preview (see admin). This `render` is the plain design-time fallback: the
 * template laid out in the configured column grid.
 *
 * Config lives in `props` (collection / sort / limit / columns / gap / where) and is driven
 * by the admin's QueryLoopSettings panel rather than generic content fields.
 */
export const queryLoop = defineBlock({
  type: "core/query-loop",
  version: 1,
  label: "Query Loop",
  icon: "Repeat",
  category: "dynamic",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {
    collection: "",
    sort: "",
    limit: 10,
    columns: 1,
    gap: "16px",
  },
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
  render: ({ props, slots, className }) => (
    <div
      className={className}
      data-nx-query-loop="preview"
      style={loopGridStyle(props)}
    >
      {slots.default}
    </div>
  ),
});
