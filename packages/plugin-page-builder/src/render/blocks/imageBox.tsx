import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { mediaAlt, mediaUrl, safeUrl, str } from "./util";

/** Image + title + description card, with the image at top / left / right. */
export const imageBox = defineBlock({
  type: "core/image-box",
  version: 1,
  label: "Image Box",
  icon: "Image",
  category: "content",
  defaultProps: {
    image: undefined,
    title: "Card title",
    description: "Short supporting description.",
    imagePosition: "top",
    link: { href: "" },
  },
  contentFields: [
    { name: "image", type: "media", label: "Image", bindable: true },
    { name: "title", type: "text", label: "Title", bindable: true },
    {
      name: "description",
      type: "textarea",
      label: "Description",
      bindable: true,
    },
    {
      name: "imagePosition",
      type: "select",
      label: "Image position",
      options: ["top", "left", "right"].map(v => ({ value: v, label: v })),
    },
    { name: "link", type: "link", label: "Link (optional)" },
  ],
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
  render: ({ props, className }) => {
    const url = mediaUrl(props.image);
    const alt = mediaAlt(props.image);
    const title = str(props.title);
    const desc = str(props.description);
    const pos = props.imagePosition;
    const row = pos === "left" || pos === "right";
    const link = props.link as { href?: string } | undefined;
    const href = safeUrl(link?.href);
    const style: CSSProperties = {
      display: "flex",
      flexDirection: row ? (pos === "right" ? "row-reverse" : "row") : "column",
      alignItems: row ? "flex-start" : "center",
      gap: 14,
      textAlign: row ? "left" : "center",
    };
    const body = (
      <>
        {url ? (
          <img
            src={url}
            alt={alt}
            loading="lazy"
            style={{
              maxWidth: row ? 140 : "100%",
              height: "auto",
              display: "block",
              borderRadius: 8,
            }}
          />
        ) : null}
        <div>
          {title ? <h3 style={{ margin: "0 0 6px" }}>{title}</h3> : null}
          {desc ? <p style={{ margin: 0 }}>{desc}</p> : null}
        </div>
      </>
    );
    return href ? (
      <a
        className={className}
        href={href}
        style={{ ...style, color: "inherit", textDecoration: "none" }}
      >
        {body}
      </a>
    ) : (
      <div className={className} style={style}>
        {body}
      </div>
    );
  },
});
