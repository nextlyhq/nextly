import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { renderInline } from "./markdown";
import { mediaUrl, safeUrl, str } from "./util";

const track: CSSProperties = {
  display: "flex",
  gap: "16px",
  overflowX: "auto",
  scrollSnapType: "x mandatory",
};

/** A slider of full-width slides (image background + heading/text/button). */
export const slides = defineBlock({
  type: "core/slides",
  version: 1,
  label: "Slides",
  icon: "Image",
  category: "media",
  defaultProps: {
    items: [
      {
        heading: "Slide one",
        text: "Supporting text",
        image: undefined,
        link: {},
      },
    ],
  },
  contentFields: [
    {
      name: "items",
      type: "repeater",
      label: "Slides",
      addLabel: "Add slide",
      itemFields: [
        { name: "image", type: "media", label: "Background" },
        { name: "heading", type: "text", label: "Heading" },
        { name: "text", type: "textarea", label: "Text" },
        { name: "link", type: "link", label: "Button link" },
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
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <div className={className} style={track}>
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const url = mediaUrl(it.image);
          const link = it.link as Record<string, unknown> | undefined;
          const href = safeUrl(link?.href);
          return (
            <div
              key={i}
              style={{
                flex: "0 0 100%",
                scrollSnapAlign: "start",
                minHeight: 320,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                padding: 32,
                color: "#fff",
                background: url
                  ? `linear-gradient(rgba(0,0,0,0.4),rgba(0,0,0,0.4)), url("${url}") center/cover`
                  : "var(--nx-color-text)",
              }}
            >
              <h2 style={{ margin: "0 0 8px" }}>{str(it.heading)}</h2>
              <div>{renderInline(str(it.text))}</div>
              {href ? (
                <a
                  href={href}
                  style={{ marginTop: 12, color: "#fff", fontWeight: 600 }}
                >
                  Learn more →
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  },
});

/** A carousel of arbitrary inner blocks (scroll-snap container). */
export const contentCarousel = defineBlock({
  type: "core/content-carousel",
  version: 1,
  label: "Content Carousel",
  icon: "Layers",
  category: "media",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { perView: "70%" },
  contentFields: [
    { name: "perView", type: "text", label: "Item width", placeholder: "70%" },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, slots, className }) => (
    <div
      className={className}
      style={{
        ...track,
        ["--nx-slide-basis" as string]: str(props.perView, "70%"),
      }}
      data-nx-content-carousel
    >
      {slots.default}
    </div>
  ),
});
