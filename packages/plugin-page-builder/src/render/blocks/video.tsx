import { defineBlock } from "../../core/registry";

function embedUrl(provider: string, id: string): string | null {
  const safeId = encodeURIComponent(id);
  if (provider === "youtube") return `https://www.youtube.com/embed/${safeId}`;
  if (provider === "vimeo") return `https://player.vimeo.com/video/${safeId}`;
  return null;
}

export const video = defineBlock({
  type: "core/video",
  version: 1,
  label: "Video",
  icon: "Video",
  category: "media",
  defaultProps: { provider: "youtube", videoId: "" },
  contentFields: [
    {
      name: "provider",
      type: "select",
      label: "Provider",
      options: [
        { value: "youtube", label: "YouTube" },
        { value: "vimeo", label: "Vimeo" },
      ],
    },
    {
      name: "videoId",
      type: "text",
      label: "Video ID",
      placeholder: "e.g. dQw4w9WgXcQ",
    },
  ],
  styleControls: [
    { control: "dimension", styleKey: "maxWidth", label: "Max width" },
    { control: "spacing", styleKey: "margin", label: "Margin" },
  ],
  render: ({ props, className }) => {
    const provider = String(props.provider ?? "");
    const id = typeof props.videoId === "string" ? props.videoId.trim() : "";
    const src = id ? embedUrl(provider, id) : null;
    if (!src) return null;
    return (
      <div className={className}>
        <iframe
          src={src}
          title="Embedded video"
          allowFullScreen
          style={{ border: 0, width: "100%", aspectRatio: "16 / 9" }}
        />
      </div>
    );
  },
});
