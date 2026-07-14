import { defineBlock } from "../../core/registry";

import { safeUrl } from "./util";

interface MediaValue {
  mediaId?: string;
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
}

interface ImageProps extends MediaValue {
  /** Editor-populated media object (from the media control). */
  media?: MediaValue;
  caption?: string;
  link?: { href?: string; target?: string };
}

export const image = defineBlock<ImageProps>({
  type: "core/image",
  version: 1,
  label: "Image",
  icon: "Image",
  category: "media",
  defaultProps: { url: "", alt: "", caption: "", link: { href: "" } },
  contentFields: [
    { name: "media", type: "media", label: "Image", bindable: true },
    { name: "caption", type: "text", label: "Caption (optional)" },
    { name: "link", type: "link", label: "Link (optional)" },
  ],
  supports: {
    dimensions: {
      width: true,
      maxWidth: true,
      objectFit: true,
      aspectRatio: true,
    },
    border: true,
    shadow: true,
    spacing: true,
    filters: true,
    opacity: true,
    position: true,
  },
  render: ({ props, className }) => {
    // `media` may be the editor's media object, or — when bound to a Query Loop item's
    // field — a `{ url }` object or a plain URL string; normalize all three.
    const raw: unknown = props.media;
    const media: MediaValue =
      typeof raw === "string" ? { url: raw } : ((raw as MediaValue) ?? {});
    const src = safeUrl(media.url ?? props.url);
    if (!src) return null;
    const alt = media.alt ?? props.alt;
    const width = media.width ?? props.width;
    const height = media.height ?? props.height;
    const caption = typeof props.caption === "string" ? props.caption : "";
    const href = safeUrl(props.link?.href);
    const target = props.link?.target || undefined;

    const img = (
      <img
        src={src}
        alt={typeof alt === "string" ? alt : ""}
        width={typeof width === "number" ? width : undefined}
        height={typeof height === "number" ? height : undefined}
        loading="lazy"
        style={{ display: "block", maxWidth: "100%" }}
      />
    );
    const linked = href ? (
      <a
        href={href}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
      >
        {img}
      </a>
    ) : (
      img
    );

    if (caption) {
      return (
        <figure className={className} style={{ margin: 0 }}>
          {linked}
          <figcaption style={{ fontSize: "0.875em", opacity: 0.75 }}>
            {caption}
          </figcaption>
        </figure>
      );
    }
    // No caption: apply the scoped class to the outermost element.
    return href ? (
      <a
        className={className}
        href={href}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
      >
        {img}
      </a>
    ) : (
      <img
        className={className}
        src={src}
        alt={typeof alt === "string" ? alt : ""}
        width={typeof width === "number" ? width : undefined}
        height={typeof height === "number" ? height : undefined}
        loading="lazy"
      />
    );
  },
});
