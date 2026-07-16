import { defineBlock } from "../../core/registry";

import { iconByName } from "./iconRegistry";
import { safeUrl, str } from "./util";

/** A row of social profile links, each rendered as an icon. */
export const socialIcons = defineBlock({
  type: "core/social-icons",
  version: 1,
  label: "Social Icons",
  icon: "Globe",
  category: "basic",
  defaultProps: {
    size: 22,
    items: [
      { network: "Twitter", url: "#" },
      { network: "Github", url: "#" },
      { network: "Linkedin", url: "#" },
    ],
  },
  contentFields: [
    { name: "size", type: "number", label: "Icon size (px)" },
    {
      name: "items",
      type: "repeater",
      label: "Profiles",
      addLabel: "Add profile",
      itemFields: [
        { name: "network", type: "icon", label: "Network icon" },
        { name: "url", type: "text", label: "URL" },
      ],
    },
  ],
  supports: {
    color: { text: true },
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const size = Number(props.size) || 22;
    return (
      <div className={className} style={{ display: "flex", gap: 12 }}>
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const Cmp = iconByName(str(it.network) || undefined);
          const href = safeUrl(it.url);
          if (!href) return null;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={str(it.network, "Social link")}
              style={{ color: "inherit" }}
            >
              <Cmp width={size} height={size} />
            </a>
          );
        })}
      </div>
    );
  },
});
