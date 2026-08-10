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
  /**
   * A placement is styled like the box it puts on the page, because that is what it is: its
   * classes are applied to the element the target renders, so these controls reach the same
   * element the block's own styles do and win by landing later.
   *
   * `motion` is switched off EXPLICITLY, because `normalizeSupports` defaults it on: an entrance
   * of `"none"` compiles to no declaration, so a placement could not switch off an animation its
   * target defines, and the control would be present and inert. `dimensions.widthAlign` is off for
   * the same reason, and explicitly for the same cause: it defaults on for every block that
   * declares dimension support. The width, max-width and margin controls reach the same result and
   * do emit declarations.
   */
  supports: {
    motion: false,
    spacing: true,
    typography: true,
    color: { text: true, background: true, gradient: true, link: true },
    background: true,
    border: true,
    shadow: true,
    dimensions: {
      width: true,
      maxWidth: true,
      minHeight: true,
      overflow: true,
      // Off for the same reason `motion` is: its neutral value emits no declaration, so a
      // placement could not undo the Wide or Full its target sets when both classes are on one
      // element. Every other block keeps it by default.
      widthAlign: false,
    },
    position: true,
    opacity: true,
    filters: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <div className={className} data-nx-ref={str(props.refId) || undefined} />
  ),
});
