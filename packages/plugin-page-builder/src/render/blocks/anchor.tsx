import { defineBlock } from "../../core/registry";

import { str } from "./util";

/** A named on-page target (Elementor "Menu Anchor") for #hash links. */
export const anchor = defineBlock({
  type: "core/anchor",
  version: 1,
  label: "Anchor",
  icon: "Link2",
  category: "layout",
  defaultProps: { anchorId: "" },
  contentFields: [
    {
      name: "anchorId",
      type: "text",
      label: "Anchor ID",
      placeholder: "section-1",
    },
  ],
  supports: { visibility: true, customCss: true },
  render: ({ props, className }) => {
    const id = str(props.anchorId) || undefined;
    return (
      <span
        className={className}
        id={id}
        aria-hidden
        style={{ display: "block" }}
      />
    );
  },
});
