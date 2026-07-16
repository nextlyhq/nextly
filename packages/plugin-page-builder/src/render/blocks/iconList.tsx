import { defineBlock } from "../../core/registry";

import { iconByName } from "./iconRegistry";
import { safeUrl, str } from "./util";

/** A list where each item has an icon, text and optional link. */
export const iconList = defineBlock({
  type: "core/icon-list",
  version: 1,
  label: "Icon List",
  icon: "Check",
  category: "basic",
  defaultProps: {
    layout: "stacked",
    items: [
      { icon: "Check", text: "First item", link: {} },
      { icon: "Check", text: "Second item", link: {} },
    ],
  },
  contentFields: [
    {
      name: "layout",
      type: "select",
      label: "Layout",
      options: [
        { value: "stacked", label: "Stacked" },
        { value: "inline", label: "Inline" },
      ],
    },
    {
      name: "items",
      type: "repeater",
      label: "Items",
      addLabel: "Add list item",
      itemFields: [
        { name: "icon", type: "icon", label: "Icon" },
        { name: "text", type: "text", label: "Text" },
        { name: "link", type: "link", label: "Link" },
      ],
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
    const inline = props.layout === "inline";
    return (
      <ul
        className={className}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: inline ? "flex" : "block",
          gap: inline ? "20px" : undefined,
          flexWrap: "wrap",
        }}
      >
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const Cmp = iconByName(str(it.icon) || undefined);
          const text = str(it.text);
          const link = it.link as Record<string, unknown> | undefined;
          const href = safeUrl(link?.href);
          const inner = (
            <>
              <Cmp width={18} height={18} style={{ flexShrink: 0 }} />
              <span>{text}</span>
            </>
          );
          return (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: inline ? 0 : 6,
              }}
            >
              {href ? (
                <a
                  href={href}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    );
  },
});
