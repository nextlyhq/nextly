import { defineBlock } from "../../core/registry";

import { mediaUrl, safeUrl, str } from "./util";

interface Flags {
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
}

function embedUrl(
  provider: string,
  id: string,
  f: Flags,
  start: number
): string | null {
  const safeId = encodeURIComponent(id);
  const p = new URLSearchParams();
  if (f.autoplay) p.set("autoplay", "1");
  if (f.muted || f.autoplay) p.set("muted", "1");
  if (f.loop) p.set("loop", "1");
  if (provider === "youtube") {
    if (!f.controls) p.set("controls", "0");
    if (start > 0) p.set("start", String(start));
    if (f.loop) p.set("playlist", safeId);
    const q = p.toString();
    return `https://www.youtube-nocookie.com/embed/${safeId}${q ? `?${q}` : ""}`;
  }
  if (provider === "vimeo") {
    if (f.muted || f.autoplay) p.set("muted", "1");
    const q = p.toString();
    return `https://player.vimeo.com/video/${safeId}${q ? `?${q}` : ""}`;
  }
  return null;
}

export const video = defineBlock({
  type: "core/video",
  version: 1,
  label: "Video",
  icon: "Video",
  category: "media",
  defaultProps: {
    provider: "youtube",
    videoId: "",
    src: "",
    poster: undefined,
    autoplay: false,
    muted: false,
    loop: false,
    controls: true,
    start: 0,
  },
  contentFields: [
    {
      name: "provider",
      type: "select",
      label: "Source",
      options: [
        { value: "youtube", label: "YouTube" },
        { value: "vimeo", label: "Vimeo" },
        { value: "self", label: "Self-hosted (MP4)" },
      ],
    },
    {
      name: "videoId",
      type: "text",
      label: "Video ID (YouTube/Vimeo)",
      placeholder: "e.g. dQw4w9WgXcQ",
    },
    { name: "src", type: "text", label: "MP4 URL (self-hosted)" },
    { name: "poster", type: "media", label: "Poster image" },
    { name: "controls", type: "boolean", label: "Show controls" },
    { name: "autoplay", type: "boolean", label: "Autoplay" },
    { name: "muted", type: "boolean", label: "Muted" },
    { name: "loop", type: "boolean", label: "Loop" },
    { name: "start", type: "number", label: "Start at (seconds)" },
  ],
  supports: {
    dimensions: { maxWidth: true, aspectRatio: true },
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    customCss: true,
  },
  render: ({ props, className }) => {
    const provider = str(props.provider, "youtube");
    const flags: Flags = {
      autoplay: props.autoplay === true,
      muted: props.muted === true,
      loop: props.loop === true,
      controls: props.controls !== false,
    };

    if (provider === "self") {
      const src = safeUrl(props.src);
      if (!src) return null;
      const poster = mediaUrl(props.poster);
      return (
        <video
          className={className}
          src={src}
          poster={poster}
          controls={flags.controls}
          autoPlay={flags.autoplay}
          muted={flags.muted || flags.autoplay}
          loop={flags.loop}
          playsInline
          style={{ width: "100%", aspectRatio: "16 / 9" }}
        />
      );
    }

    const id = str(props.videoId).trim();
    const start = Number(props.start) || 0;
    const src = id ? embedUrl(provider, id, flags, start) : null;
    if (!src) return null;
    return (
      <div className={className}>
        <iframe
          src={src}
          title="Embedded video"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={{ border: 0, width: "100%", aspectRatio: "16 / 9" }}
        />
      </div>
    );
  },
});
