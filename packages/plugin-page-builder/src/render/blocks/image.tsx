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
  contentFields: [{ name: "media", type: "media", label: "Image" }],
  styleControls: [
    { control: "dimension", styleKey: "width", label: "Width" },
    { control: "dimension", styleKey: "borderRadius", label: "Radius" },
    { control: "spacing", styleKey: "margin", label: "Margin" },
  ],
  render: ({ props, className }) => {
    // Prefer the editor's media object; fall back to flat props (back-compat).
    const media = props.media ?? {};
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
