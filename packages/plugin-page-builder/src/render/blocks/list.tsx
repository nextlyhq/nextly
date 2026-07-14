import { createElement } from "react";

import { defineBlock } from "../../core/registry";

import { renderInline } from "./markdown";
import { str } from "./util";

/** A simple ordered / unordered text list. */
export const list = defineBlock({
  type: "core/list",
  version: 1,
  label: "List",
  icon: "List",
  category: "basic",
  defaultProps: {
    ordered: false,
    items: [{ text: "First item" }, { text: "Second item" }],
  },
  contentFields: [
    { name: "ordered", type: "boolean", label: "Ordered (numbered)" },
    {
      name: "items",
      type: "repeater",
      label: "Items",
      addLabel: "Add item",
      itemFields: [{ name: "text", type: "text", label: "Text" }],
    },
  ],
  supports: {
    typography: true,
    color: { text: true },
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const tag = props.ordered ? "ol" : "ul";
    return createElement(
      tag,
      { className },
      items.map((raw, i) =>
        createElement(
          "li",
          { key: i },
          renderInline(str((raw as Record<string, unknown>)?.text))
        )
      )
    );
  },
});
