import { coverStructure } from "../../core/block-structure";
import { defineBlock } from "../../core/registry";
import { safeValue } from "../../core/style-compiler";

import { cssMediaUrl, str } from "./util";

/** A full-bleed hero: background image + color overlay, centered inner blocks. */
export const cover = defineBlock({
  ...coverStructure,
  version: 1,
  label: "Cover",
  icon: "Image",
  category: "media",
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
  render: ({ props, slots, className, remotePatterns }) => {
    // `cssMediaUrl`: this is interpolated into a CSS `url("…")`, so the
    // delimiters that would end it are refused as well as the origin.
    const url = cssMediaUrl(props.image, remotePatterns);
    // The overlay is arbitrary author text assigned to `background`, which is
    // fetch-capable: `url("https://…")` is a valid value there. It goes through
    // the same value policy a structured style does, so an undeclared host is
    // refused and anything that fails to parse falls back to the default.
    const overlay =
      safeValue(str(props.overlayColor, "#000000"), remotePatterns) ??
      "#000000";
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
