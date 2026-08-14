import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { mediaUrl, safeUrl } from "./util";

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
  aspectPreset?: string;
  rounded?: boolean;
}

/**
 * "Whatever shape the file already is", as a value a Select can carry.
 *
 * Radix refuses an item whose value is the empty string — it reserves that for the
 * unset state that shows the placeholder — so keeping the image's own ratio needs a
 * name rather than an absence. Any value that is not `W/H` leaves the ratio alone,
 * so this reads the same to the renderer as the unset it replaces.
 */
const ORIGINAL_ASPECT = "original";

export const image = defineBlock<ImageProps>({
  type: "core/image",
  version: 2,
  label: "Image",
  icon: "Image",
  category: "media",
  defaultProps: {
    url: "",
    alt: "",
    caption: "",
    link: { href: "" },
    aspectPreset: ORIGINAL_ASPECT,
    rounded: false,
  },
  // A stored image carries `""` for its ratio, which the Select reads as "nothing
  // chosen" and shows as a placeholder instead of the choice the author made.
  migrate: (old, from) => {
    const props = { ...(old as ImageProps) };
    if (from < 2 && props.aspectPreset === "") {
      props.aspectPreset = ORIGINAL_ASPECT;
    }
    return { props };
  },
  contentFields: [
    { name: "media", type: "media", label: "Image", bindable: true },
    { name: "caption", type: "text", label: "Caption (optional)" },
    { name: "link", type: "link", label: "Link (optional)" },
    {
      name: "aspectPreset",
      type: "select",
      label: "Aspect ratio",
      options: [
        { value: ORIGINAL_ASPECT, label: "Original" },
        { value: "1/1", label: "Square" },
        { value: "4/3", label: "Standard" },
        { value: "3/4", label: "Portrait" },
        { value: "3/2", label: "Classic" },
        { value: "2/3", label: "Classic Portrait" },
        { value: "16/9", label: "Wide" },
        { value: "9/16", label: "Tall" },
      ],
    },
    { name: "rounded", type: "boolean", label: "Rounded" },
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
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className, remotePatterns }) => {
    // `media` may be the editor's media object, or — when bound to a Query Loop item's
    // field — a `{ url }` object or a plain URL string; normalize all three.
    const raw: unknown = props.media;
    const media: MediaValue =
      typeof raw === "string" ? { url: raw } : ((raw as MediaValue) ?? {});
    // `mediaUrl` rather than `safeUrl`: this becomes an `<img src>`, which the
    // browser fetches on its own, and the image is lazy — so whether the
    // request happens depends on where the element renders, which CSS decides.
    // That is the same conditional fetch a block background is, and it is
    // gated the same way. `safeUrl` below is right for the LINK, because a
    // navigation only happens when someone clicks it.
    const src = mediaUrl(media.url ?? props.url, remotePatterns);
    if (!src) return null;
    const alt = media.alt ?? props.alt;
    const width = media.width ?? props.width;
    const height = media.height ?? props.height;
    const caption = typeof props.caption === "string" ? props.caption : "";
    const href = safeUrl(props.link?.href);
    const target = props.link?.target || undefined;
    const aspect =
      typeof props.aspectPreset === "string" &&
      /^\d+\/\d+$/.test(props.aspectPreset)
        ? props.aspectPreset
        : "";

    const imgStyle: CSSProperties = {
      display: "block",
      maxWidth: "100%",
      ...(aspect
        ? { aspectRatio: aspect, objectFit: "cover", width: "100%" }
        : {}),
      ...(props.rounded ? { borderRadius: "12px" } : {}),
    };
    const imgEl = (cls?: string) => (
      <img
        className={cls}
        src={src}
        alt={typeof alt === "string" ? alt : ""}
        width={typeof width === "number" ? width : undefined}
        height={typeof height === "number" ? height : undefined}
        loading="lazy"
        style={imgStyle}
      />
    );

    if (caption) {
      const inner = href ? (
        <a
          href={href}
          target={target}
          rel={target === "_blank" ? "noopener noreferrer" : undefined}
        >
          {imgEl()}
        </a>
      ) : (
        imgEl()
      );
      return (
        <figure className={className}>
          {inner}
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
        {imgEl()}
      </a>
    ) : (
      imgEl(className)
    );
  },
});
