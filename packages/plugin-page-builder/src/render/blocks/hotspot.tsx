import { defineBlock } from "../../core/registry";

import { mediaUrl, str } from "./util";

/** An image with positioned marker dots (title shown on hover via the `title` attr). */
export const hotspot = defineBlock({
  type: "core/hotspot",
  version: 1,
  label: "Hotspot",
  icon: "MapPin",
  category: "media",
  defaultProps: {
    image: undefined,
    points: [{ x: "50", y: "50", label: "A point of interest" }],
  },
  contentFields: [
    { name: "image", type: "media", label: "Image" },
    {
      name: "points",
      type: "repeater",
      label: "Points",
      addLabel: "Add point",
      itemFields: [
        { name: "x", type: "number", label: "X %" },
        { name: "y", type: "number", label: "Y %" },
        { name: "label", type: "text", label: "Label" },
      ],
    },
  ],
  supports: {
    spacing: true,
    border: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const url = mediaUrl(props.image);
    const points = Array.isArray(props.points) ? props.points : [];
    return (
      <div
        className={className}
        style={{ position: "relative", display: "inline-block" }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            style={{ display: "block", maxWidth: "100%" }}
          />
        ) : null}
        {points.map((raw, i) => {
          const p = (raw ?? {}) as Record<string, unknown>;
          const x = Math.min(Math.max(Number(p.x) || 0, 0), 100);
          const y = Math.min(Math.max(Number(p.y) || 0, 0), 100);
          return (
            <span
              key={i}
              title={str(p.label)}
              aria-label={str(p.label)}
              style={{
                position: "absolute",
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "#4f46e5",
                border: "3px solid #fff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                cursor: "help",
              }}
            />
          );
        })}
      </div>
    );
  },
});
