import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { mediaAlt, mediaUrl, str } from "./util";

/** Shared CSS scroll-snap track — a real, accessible carousel with no client JS. */
const track: CSSProperties = {
  display: "flex",
  gap: "16px",
  overflowX: "auto",
  scrollSnapType: "x mandatory",
  padding: "4px",
};
const slide = (basis: string): CSSProperties => ({
  flex: `0 0 ${basis}`,
  scrollSnapAlign: "start",
});

const imageItems = (props: Record<string, unknown>) =>
  Array.isArray(props.items) ? props.items : [];

/** Horizontally scrollable image carousel. */
export const imageCarousel = defineBlock({
  type: "core/image-carousel",
  version: 1,
  label: "Image Carousel",
  icon: "Image",
  category: "media",
  defaultProps: { perView: "60%", items: [] },
  contentFields: [
    { name: "perView", type: "text", label: "Slide width", placeholder: "60%" },
    {
      name: "items",
      type: "repeater",
      label: "Images",
      addLabel: "Add image",
      itemFields: [
        { name: "image", type: "media", label: "Image" },
        { name: "alt", type: "text", label: "Alt" },
      ],
    },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <div className={className} style={track}>
      {imageItems(props).map((raw, i) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        const url = mediaUrl(it.image);
        if (!url) return null;
        return (
          <div key={i} style={slide(str(props.perView, "60%"))}>
            <img
              src={url}
              alt={str(it.alt) || mediaAlt(it.image)}
              loading="lazy"
              style={{ width: "100%", borderRadius: 8, display: "block" }}
            />
          </div>
        );
      })}
    </div>
  ),
});

/** Horizontally scrollable logo strip. */
export const logoCarousel = defineBlock({
  type: "core/logo-carousel",
  version: 1,
  label: "Logo Carousel",
  icon: "Layers",
  category: "media",
  defaultProps: { items: [] },
  contentFields: [
    {
      name: "items",
      type: "repeater",
      label: "Logos",
      addLabel: "Add logo",
      itemFields: [
        { name: "image", type: "media", label: "Logo" },
        { name: "alt", type: "text", label: "Name" },
      ],
    },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <div className={className} style={{ ...track, alignItems: "center" }}>
      {imageItems(props).map((raw, i) => {
        const it = (raw ?? {}) as Record<string, unknown>;
        const url = mediaUrl(it.image);
        if (!url) return null;
        return (
          <div key={i} style={slide("160px")}>
            <img
              src={url}
              alt={str(it.alt) || mediaAlt(it.image)}
              loading="lazy"
              style={{ maxHeight: 48, width: "auto", display: "block" }}
            />
          </div>
        );
      })}
    </div>
  ),
});
