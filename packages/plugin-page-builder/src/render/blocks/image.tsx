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
}

export const image = defineBlock<ImageProps>({
  type: "core/image",
  version: 1,
  label: "Image",
  icon: "Image",
  category: "media",
  defaultProps: { url: "", alt: "" },
  contentFields: [
    { name: "media", type: "media", label: "Image", bindable: true },
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
    return (
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
