import { defineBlock } from "../../core/registry";

import { renderMarkdown } from "./markdown";
import { safeUrl, str } from "./util";

/** A single collapsible toggle (native <details>, no JS). */
export const toggle = defineBlock({
  type: "core/toggle",
  version: 1,
  label: "Toggle",
  icon: "ChevronRight",
  category: "layout",
  defaultProps: {
    title: "Toggle title",
    content: "Hidden content revealed when opened.",
    open: false,
  },
  contentFields: [
    { name: "title", type: "text", label: "Title" },
    { name: "content", type: "textarea", label: "Content (Markdown)" },
    { name: "open", type: "boolean", label: "Open by default" },
  ],
  supports: {
    spacing: true,
    border: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <details
      className={className}
      open={props.open === true}
      style={{ borderBottom: "1px solid var(--nx-color-border)" }}
    >
      <summary
        style={{ cursor: "pointer", padding: "10px 0", fontWeight: 600 }}
      >
        {str(props.title, "Toggle")}
      </summary>
      <div style={{ padding: "0 0 10px" }}>
        {renderMarkdown(str(props.content))}
      </div>
    </details>
  ),
});

/** An off-canvas slide-in panel toggled by the CSS checkbox-hack (no JS). */
export const offCanvas = defineBlock({
  type: "core/off-canvas",
  version: 1,
  label: "Off Canvas",
  icon: "Layers",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: { triggerText: "Open menu", side: "right" },
  contentFields: [
    { name: "triggerText", type: "text", label: "Trigger label" },
    {
      name: "side",
      type: "select",
      label: "Side",
      options: [
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
      ],
    },
  ],
  supports: {
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, node, slots, className }) => {
    const id = node.id;
    const left = props.side === "left";
    const css = `
#nx-oc-${id}{position:absolute;opacity:0;pointer-events:none}
.nx-oc-${id}-panel{position:fixed;top:0;${left ? "left" : "right"}:0;height:100%;width:320px;max-width:85vw;background:#fff;box-shadow:0 0 40px rgba(0,0,0,0.3);transform:translateX(${left ? "-100%" : "100%"});transition:transform .3s ease;z-index:1000;padding:24px;overflow:auto}
.nx-oc-${id}-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.4);opacity:0;pointer-events:none;transition:opacity .3s;z-index:999}
#nx-oc-${id}:checked ~ .nx-oc-${id}-panel{transform:translateX(0)}
#nx-oc-${id}:checked ~ .nx-oc-${id}-overlay{opacity:1;pointer-events:auto}`;
    return (
      <div className={className}>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <input
          type="checkbox"
          id={`nx-oc-${id}`}
          aria-label={str(props.triggerText, "Open menu")}
        />
        <label
          htmlFor={`nx-oc-${id}`}
          style={{
            display: "inline-block",
            padding: "8px 16px",
            borderRadius: 8,
            background: "var(--nx-color-primary)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {str(props.triggerText, "Open")}
        </label>
        <label
          htmlFor={`nx-oc-${id}`}
          className={`nx-oc-${id}-overlay`}
          aria-label="Close"
        />
        <div className={`nx-oc-${id}-panel`}>{slots.default}</div>
      </div>
    );
  },
});

/** A Google Maps embed (validated https iframe, or a place query). */
export const map = defineBlock({
  type: "core/map",
  version: 1,
  label: "Map",
  icon: "MapPin",
  category: "utility",
  defaultProps: { query: "Eiffel Tower, Paris", src: "", height: 320 },
  contentFields: [
    { name: "query", type: "text", label: "Place query" },
    { name: "src", type: "text", label: "Embed URL (https, optional)" },
    { name: "height", type: "number", label: "Height (px)" },
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
    const explicit = safeUrl(props.src);
    const src =
      explicit && /^https:\/\//i.test(explicit)
        ? explicit
        : props.query
          ? `https://www.google.com/maps?q=${encodeURIComponent(str(props.query))}&output=embed`
          : "";
    if (!src) return null;
    return (
      <div className={className}>
        <iframe
          src={src}
          title="Map"
          loading="lazy"
          style={{ border: 0, width: "100%", height }}
        />
      </div>
    );
  },
});
