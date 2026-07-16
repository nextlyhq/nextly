import { sanitizeEmbedHtml } from "../../core/embed-sanitize";
import { defineBlock } from "../../core/registry";

import { safeUrl, str } from "./util";

/**
 * HTML / Embed. Two modes: an https iframe URL (safe), or raw HTML passed through a
 * conservative sanitizer (trusted authors only). Restrict via a plugin permission in
 * production if untrusted authors can edit pages.
 */
export const embed = defineBlock({
  type: "core/embed",
  version: 1,
  label: "HTML / Embed",
  icon: "Globe",
  category: "utility",
  defaultProps: { mode: "url", url: "", html: "", height: 320 },
  contentFields: [
    {
      name: "mode",
      type: "select",
      label: "Mode",
      options: [
        { value: "url", label: "Embed URL (iframe)" },
        { value: "html", label: "Custom HTML" },
      ],
    },
    { name: "url", type: "text", label: "Embed URL (https)" },
    { name: "html", type: "textarea", label: "Custom HTML" },
    { name: "height", type: "number", label: "Min height (px)" },
  ],
  supports: {
    spacing: true,
    border: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const height = Number(props.height) || 320;
    if (props.mode === "html") {
      const clean = sanitizeEmbedHtml(str(props.html));
      if (!clean) return null;
      return (
        <div
          className={className}
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      );
    }
    const url = safeUrl(props.url);
    if (!url || !/^https:\/\//i.test(url)) return null;
    return (
      <div className={className}>
        <iframe
          src={url}
          title="Embedded content"
          loading="lazy"
          style={{ border: 0, width: "100%", minHeight: height }}
        />
      </div>
    );
  },
});
