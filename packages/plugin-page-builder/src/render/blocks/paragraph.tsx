import { defineBlock } from "../../core/registry";

export const paragraph = defineBlock({
  type: "core/paragraph",
  version: 1,
  label: "Paragraph",
  icon: "Type",
  category: "basic",
  defaultProps: { text: "New paragraph" },
  render: ({ props, className }) => (
    <p className={className}>{String(props.text ?? "")}</p>
  ),
});
