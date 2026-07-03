import { defineBlock } from "../../core/registry";

export const container = defineBlock({
  type: "core/container",
  version: 1,
  label: "Container",
  icon: "Square",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {},
  styleControls: [
    { control: "color", styleKey: "backgroundColor", label: "Background" },
    { control: "dimension", styleKey: "maxWidth", label: "Max width" },
    { control: "spacing", styleKey: "padding", label: "Padding" },
    { control: "spacing", styleKey: "margin", label: "Margin" },
    { control: "dimension", styleKey: "borderRadius", label: "Radius" },
  ],
  render: ({ slots, className }) => (
    <section className={className}>{slots.default}</section>
  ),
});
