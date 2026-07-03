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
  styleControls: [
    { control: "color", styleKey: "color", label: "Text color" },
    { control: "dimension", styleKey: "fontSize", label: "Font size" },
    { control: "align", styleKey: "textAlign", label: "Align" },
    { control: "spacing", styleKey: "padding", label: "Padding" },
    { control: "spacing", styleKey: "margin", label: "Margin" },
  ],
  render: ({ props, className }) => (
    <p className={className}>{String(props.text ?? "")}</p>
  ),
});
