import { defineBlock } from "../../core/registry";

import { renderInline } from "./markdown";
import { str } from "./util";

export const paragraph = defineBlock({
  type: "core/paragraph",
  version: 1,
  label: "Paragraph",
  icon: "Type",
  category: "basic",
  defaultProps: { text: "New paragraph" },
  contentFields: [
    {
      name: "text",
      type: "textarea",
      label: "Text (supports **bold**, *italic*, [links](url), ==highlight==)",
      bindable: true,
    },
  ],
  supports: {
    typography: true,
    color: { text: true, background: true, link: true },
    background: { gradient: true },
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    interactions: { hover: true },
  },
  render: ({ props, className }) => (
    <p className={className}>{renderInline(str(props.text))}</p>
  ),
});
