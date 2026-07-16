import { defineBlock } from "../../core/registry";

import { ICON_NAMES, iconByName } from "./iconRegistry";
import { str } from "./util";

/** A single icon from the curated lucide set. Color follows the `color` style (currentColor). */
export const icon = defineBlock({
  type: "core/icon",
  version: 1,
  label: "Icon",
  icon: "Star",
  category: "basic",
  defaultProps: { icon: "Star", size: "32" },
  contentFields: [
    {
      name: "icon",
      type: "select",
      label: "Icon",
      options: ICON_NAMES.map(n => ({ value: n, label: n })),
    },
    { name: "size", type: "number", label: "Size (px)", placeholder: "32" },
  ],
  supports: {
    color: { text: true },
    spacing: true,
    opacity: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const Cmp = iconByName(str(props.icon) || undefined);
    const size = Number(props.size) || 32;
    return <Cmp className={className} width={size} height={size} />;
  },
});
