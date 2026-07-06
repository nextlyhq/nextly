import { createElement } from "react";

import { defineBlock } from "../../core/registry";

const TAGS = ["section", "div", "article", "header", "footer", "aside"];

export const container = defineBlock({
  type: "core/container",
  version: 1,
  label: "Container",
  icon: "Square",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { as: "section" },
  contentFields: [
    {
      name: "as",
      type: "select",
      label: "HTML tag",
      options: TAGS.map(t => ({ value: t, label: t })),
    },
  ],
  styleControls: [
    { control: "color", styleKey: "backgroundColor", label: "Background" },
    { control: "dimension", styleKey: "maxWidth", label: "Max width" },
    { control: "spacing", styleKey: "padding", label: "Padding" },
    { control: "spacing", styleKey: "margin", label: "Margin" },
    { control: "dimension", styleKey: "borderRadius", label: "Radius" },
  ],
  render: ({ props, slots, className }) => {
    const tag = TAGS.includes(String(props.as)) ? String(props.as) : "section";
    return createElement(tag, { className }, slots.default);
  },
});
