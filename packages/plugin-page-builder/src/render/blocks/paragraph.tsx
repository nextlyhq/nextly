import { defineBlock } from "../../core/registry";

export const paragraph = defineBlock({
  type: "core/paragraph",
  version: 1,
  label: "Paragraph",
  icon: "Type",
  category: "basic",
  defaultProps: { text: "New paragraph" },
  contentFields: [
    { name: "text", type: "textarea", label: "Text", bindable: true },
  ],
  supports: {
    typography: true,
    color: { text: true },
    spacing: true,
    border: true,
    shadow: true,
    interactions: { hover: true },
  },
  render: ({ props, className }) => (
    <p className={className}>{String(props.text ?? "")}</p>
  ),
});
