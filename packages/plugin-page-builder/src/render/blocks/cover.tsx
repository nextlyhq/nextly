import { defineBlock } from "../../core/registry";

import { mediaUrl, str } from "./util";

/** A full-bleed hero: background image + color overlay, centered inner blocks. */
export const cover = defineBlock({
  type: "core/cover",
  version: 1,
  label: "Cover",
  icon: "Image",
  category: "media",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {
    image: undefined,
    overlayColor: "#000000",
    overlayOpacity: 0.4,
    minHeight: "360px",
  },
  contentFields: [
    { name: "image", type: "media", label: "Background image" },
    { name: "overlayColor", type: "text", label: "Overlay color" },
    { name: "overlayOpacity", type: "number", label: "Overlay opacity (0–1)" },
    { name: "minHeight", type: "text", label: "Min height" },
  ],
  supports: {
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, slots, className }) => {
    const url = mediaUrl(props.image);
    const overlay = str(props.overlayColor, "#000000");
    const opacity = Number(props.overlayOpacity);
    return (
      <div
        className={className}
        style={{
          position: "relative",
          minHeight: str(props.minHeight, "360px"),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          backgroundImage: url ? `url("${url}")` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: overlay,
            opacity: Number.isFinite(opacity) ? opacity : 0.4,
          }}
        />
        <div style={{ position: "relative", width: "100%" }}>
          {slots.default}
        </div>
      </div>
    );
  },
});
