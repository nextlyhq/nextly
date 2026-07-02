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
  render: ({ slots, className }) => (
    <section className={className}>{slots.default}</section>
  ),
});
