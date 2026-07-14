import { defineBlock } from "../../core/registry";

import { str } from "./util";

/**
 * A reusable-block reference (spec §H). At render, `RenderNode` intercepts this type and
 * resolves `refId` against the `refs` library (cycle-guarded); this render is only the
 * design-time placeholder shown when no library is provided.
 */
export const ref = defineBlock({
  type: "core/ref",
  version: 1,
  label: "Reusable",
  icon: "Copy",
  category: "utility",
  defaultProps: { refId: "" },
  contentFields: [{ name: "refId", type: "text", label: "Reference ID" }],
  supports: { visibility: true, customCss: true, customAttributes: true },
  render: ({ props, className }) => (
    <div className={className} data-nx-ref={str(props.refId) || undefined} />
  ),
});
