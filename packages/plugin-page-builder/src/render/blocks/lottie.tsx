import { defineBlock } from "../../core/registry";

import { safeUrl } from "./util";

/**
 * Lottie animation. Renders the `<lottie-player>` web component pointing at a `.json`/`.lottie`
 * URL. The host page must include the lottie-player script (documented) for playback; the
 * markup degrades to nothing without it. A validated https URL is required.
 */
export const lottie = defineBlock({
  type: "core/lottie",
  version: 1,
  label: "Lottie",
  icon: "Sparkles",
  category: "media",
  defaultProps: { src: "", loop: true, autoplay: true, height: 300 },
  contentFields: [
    {
      name: "src",
      type: "text",
      label: "Animation URL (.json/.lottie, https)",
    },
    { name: "loop", type: "boolean", label: "Loop" },
    { name: "autoplay", type: "boolean", label: "Autoplay" },
    { name: "height", type: "number", label: "Height (px)" },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const src = safeUrl(props.src);
    if (!src || !/^https:\/\//i.test(src)) return null;
    const height = Number(props.height) || 300;
    // Custom element; attributes are strings. React renders unknown elements as-is.
    return (
      <div className={className}>
        {/* @ts-expect-error lottie-player is a custom element */}
        <lottie-player
          src={src}
          style={{ width: "100%", height }}
          {...(props.loop !== false ? { loop: "true" } : {})}
          {...(props.autoplay !== false ? { autoplay: "true" } : {})}
        />
      </div>
    );
  },
});
