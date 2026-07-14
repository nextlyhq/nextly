import { defineBlock } from "../../core/registry";

import { mediaAlt, mediaUrl, str } from "./util";

/** A responsive grid image gallery. */
export const gallery = defineBlock({
  type: "core/gallery",
  version: 1,
  label: "Gallery",
  icon: "Image",
  category: "media",
  defaultProps: {
    columns: 3,
    gap: "12px",
    items: [],
  },
  contentFields: [
    { name: "columns", type: "number", label: "Columns" },
    { name: "gap", type: "text", label: "Gap", placeholder: "12px" },
    {
      name: "items",
      type: "repeater",
      label: "Images",
      addLabel: "Add image",
      itemFields: [
        { name: "image", type: "media", label: "Image" },
        { name: "alt", type: "text", label: "Alt text" },
      ],
    },
  ],
  supports: {
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const cols = Math.min(Math.max(Number(props.columns) || 3, 1), 8);
    return (
      <div
        className={className}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: str(props.gap, "12px"),
        }}
      >
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const url = mediaUrl(it.image);
          if (!url) return null;
          const alt = str(it.alt) || mediaAlt(it.image);
          return (
            <img
              key={i}
              src={url}
              alt={alt}
              loading="lazy"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                borderRadius: 6,
              }}
            />
          );
        })}
      </div>
    );
  },
});
