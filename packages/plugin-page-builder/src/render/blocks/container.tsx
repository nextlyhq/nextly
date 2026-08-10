import { createElement } from "react";

import { containerStructure } from "../../core/block-structure";
import { defineBlock } from "../../core/registry";

const TAGS = ["section", "div", "article", "header", "footer", "aside"];

export const container = defineBlock({
  // Structure spread in rather than restated, so the slots this block draws and the slots the
  // validator enforces cannot drift apart.
  ...containerStructure,
  version: 1,
  label: "Container",
  icon: "Square",
  category: "layout",
  defaultProps: { as: "section" },
  contentFields: [
    {
      name: "as",
      type: "select",
      label: "HTML tag",
      options: TAGS.map(t => ({ value: t, label: t })),
    },
  ],
  supports: {
    color: { background: true, link: true },
    background: true,
    spacing: true,
    border: true,
    shadow: true,
    dimensions: { maxWidth: true, minHeight: true, overflow: true },
    position: true,
    opacity: true,
    filters: true,
  },
  render: ({ props, slots, className }) => {
    const tag = TAGS.includes(String(props.as)) ? String(props.as) : "section";
    return createElement(tag, { className }, slots.default);
  },
});
