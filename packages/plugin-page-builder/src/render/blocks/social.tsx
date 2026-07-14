import type { CSSProperties, ReactNode } from "react";

import { defineBlock } from "../../core/registry";

import { iconByName } from "./iconRegistry";
import { mediaAlt, mediaUrl, str } from "./util";

function testimonialCard(it: Record<string, unknown>, key?: number): ReactNode {
  const avatar = mediaUrl(it.avatar);
  return (
    <figure
      key={key}
      style={{
        margin: 0,
        padding: 20,
        border: "1px solid var(--nx-color-border)",
        borderRadius: 12,
      }}
    >
      <blockquote style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}>
        “{str(it.quote)}”
      </blockquote>
      <figcaption
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 14,
        }}
      >
        {avatar ? (
          <img
            src={avatar}
            alt=""
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        ) : null}
        <span>
          <strong>{str(it.author)}</strong>
          <br />
          <span style={{ opacity: 0.7 }}>{str(it.role)}</span>
        </span>
      </figcaption>
    </figure>
  );
}

const TESTIMONIAL_FIELDS = [
  { name: "quote", type: "textarea" as const, label: "Quote" },
  { name: "author", type: "text" as const, label: "Author" },
  { name: "role", type: "text" as const, label: "Role" },
  { name: "avatar", type: "media" as const, label: "Avatar" },
];

/** A single testimonial. */
export const testimonial = defineBlock({
  type: "core/testimonial",
  version: 1,
  label: "Testimonial",
  icon: "MessageCircle",
  category: "content",
  defaultProps: {
    quote: "This product changed how our team works.",
    author: "Jane Doe",
    role: "CTO, Acme",
    avatar: undefined,
  },
  contentFields: TESTIMONIAL_FIELDS,
  supports: {
    typography: true,
    color: { text: true, background: true },
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <div className={className}>{testimonialCard(props)}</div>
  ),
});

const track: CSSProperties = {
  display: "flex",
  gap: 16,
  overflowX: "auto",
  scrollSnapType: "x mandatory",
};

/** A scroll-snap carousel of testimonials. */
export const testimonialCarousel = defineBlock({
  type: "core/testimonial-carousel",
  version: 1,
  label: "Testimonial Carousel",
  icon: "MessageCircle",
  category: "content",
  defaultProps: { items: [] },
  contentFields: [
    {
      name: "items",
      type: "repeater",
      label: "Testimonials",
      addLabel: "Add testimonial",
      itemFields: TESTIMONIAL_FIELDS,
    },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <div className={className} style={track}>
        {items.map((raw, i) => (
          <div key={i} style={{ flex: "0 0 80%", scrollSnapAlign: "start" }}>
            {testimonialCard((raw ?? {}) as Record<string, unknown>)}
          </div>
        ))}
      </div>
    );
  },
});

/** A grid of customer reviews with star ratings. */
export const reviews = defineBlock({
  type: "core/reviews",
  version: 1,
  label: "Reviews",
  icon: "Star",
  category: "content",
  defaultProps: {
    items: [{ author: "Sam", rating: 5, text: "Excellent!" }],
  },
  contentFields: [
    {
      name: "items",
      type: "repeater",
      label: "Reviews",
      addLabel: "Add review",
      itemFields: [
        { name: "author", type: "text", label: "Author" },
        { name: "rating", type: "number", label: "Rating (0–5)" },
        { name: "text", type: "textarea", label: "Text" },
      ],
    },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const Star = iconByName("Star");
    return (
      <div
        className={className}
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        }}
      >
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const r = Math.min(Math.max(Number(it.rating) || 0, 0), 5);
          return (
            <div
              key={i}
              style={{
                border: "1px solid var(--nx-color-border)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  color: "var(--nx-color-accent)",
                  marginBottom: 6,
                }}
                aria-label={`${r} out of 5`}
              >
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star
                    key={j}
                    width={16}
                    height={16}
                    fill={j < Math.round(r) ? "currentColor" : "none"}
                  />
                ))}
              </div>
              <p style={{ margin: "0 0 8px" }}>{str(it.text)}</p>
              <strong>{str(it.author)}</strong>
            </div>
          );
        })}
      </div>
    );
  },
});

/** A grid of partner/customer logos. */
export const logoCloud = defineBlock({
  type: "core/logo-cloud",
  version: 1,
  label: "Logo Cloud",
  icon: "Layers",
  category: "content",
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
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <div
        className={className}
        style={{
          display: "grid",
          gap: 24,
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          alignItems: "center",
        }}
      >
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          const url = mediaUrl(it.image);
          if (!url) return null;
          return (
            <img
              key={i}
              src={url}
              alt={str(it.alt) || mediaAlt(it.image)}
              loading="lazy"
              style={{
                maxHeight: 40,
                width: "auto",
                margin: "0 auto",
                display: "block",
              }}
            />
          );
        })}
      </div>
    );
  },
});
