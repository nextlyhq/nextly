import { createElement } from "react";

import { defineBlock } from "../../core/registry";

const LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"];

export const heading = defineBlock({
  type: "core/heading",
  version: 1,
  label: "Heading",
  icon: "Heading",
  category: "basic",
  defaultProps: { text: "New heading", level: "h2" },
  contentFields: [
    { name: "text", type: "text", label: "Text", bindable: true },
    {
      name: "level",
      type: "select",
      label: "Level",
      options: LEVELS.map(l => ({ value: l, label: l.toUpperCase() })),
    },
  ],
  supports: {
    typography: true,
    color: { text: true },
    spacing: true,
    border: true,
    shadow: true,
    dimensions: { width: true, maxWidth: true },
    position: true,
    opacity: true,
    interactions: { hover: true },
  },
  render: ({ props, className }) => {
    const level = LEVELS.includes(String(props.level))
      ? String(props.level)
      : "h2";
    return createElement(level, { className }, String(props.text ?? ""));
  },
});
