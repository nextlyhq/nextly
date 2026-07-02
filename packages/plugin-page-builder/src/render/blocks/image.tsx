import { defineBlock } from "../../core/registry";

import { safeUrl } from "./util";

interface ImageProps {
  mediaId?: string;
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export const image = defineBlock<ImageProps>({
  type: "core/image",
  version: 1,
  label: "Image",
  icon: "Image",
  category: "media",
  defaultProps: { url: "", alt: "" },
  render: ({ props, className }) => {
    const src = safeUrl(props.url);
    if (!src) return null;
    return (
      <img
        className={className}
        src={src}
        alt={typeof props.alt === "string" ? props.alt : ""}
        width={typeof props.width === "number" ? props.width : undefined}
        height={typeof props.height === "number" ? props.height : undefined}
        loading="lazy"
      />
    );
  },
});
