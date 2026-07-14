import { defineBlock } from "../../core/registry";

import { renderInline } from "./markdown";
import { mediaUrl, safeUrl, str } from "./util";

/** Call-to-action card: heading + text + button, boxed. */
export const ctaCard = defineBlock({
  type: "core/cta-card",
  version: 1,
  label: "CTA Card",
  icon: "Rocket",
  category: "content",
  defaultProps: {
    heading: "Ready to start?",
    text: "A short, compelling call to action.",
    buttonText: "Get started",
    link: { href: "#" },
  },
  contentFields: [
    { name: "heading", type: "text", label: "Heading", bindable: true },
    { name: "text", type: "textarea", label: "Text", bindable: true },
    { name: "buttonText", type: "text", label: "Button label" },
    { name: "link", type: "link", label: "Button link" },
  ],
  defaultStyle: {
    base: {
      backgroundColor: "var(--nx-color-surface)",
      padding: { top: "32px", right: "32px", bottom: "32px", left: "32px" },
      borderRadius: "12px",
      textAlign: "center",
    },
  },
  supports: {
    typography: true,
    color: { text: true, background: true },
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const href = safeUrl((props.link as { href?: string })?.href);
    return (
      <div className={className}>
        <h3 style={{ margin: "0 0 8px" }}>{str(props.heading)}</h3>
        <div style={{ marginBottom: 16 }}>{renderInline(str(props.text))}</div>
        {href ? (
          <a
            href={href}
            style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 8,
              background: "var(--nx-color-primary)",
              color: "#fff",
              textDecoration: "none",
            }}
          >
            {str(props.buttonText, "Learn more")}
          </a>
        ) : null}
      </div>
    );
  },
});

/** Flip box: front / back faces, flipped on hover via CSS (no JS). */
export const flipBox = defineBlock({
  type: "core/flip-box",
  version: 1,
  label: "Flip Box",
  icon: "Layers",
  category: "content",
  defaultProps: {
    frontTitle: "Hover me",
    frontImage: undefined,
    backTitle: "The back",
    backText: "Details revealed on hover.",
    height: 260,
  },
  contentFields: [
    { name: "frontImage", type: "media", label: "Front image" },
    { name: "frontTitle", type: "text", label: "Front title" },
    { name: "backTitle", type: "text", label: "Back title" },
    { name: "backText", type: "textarea", label: "Back text" },
    { name: "height", type: "number", label: "Height (px)" },
  ],
  supports: {
    visibility: true,
    spacing: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, node, className }) => {
    const h = Number(props.height) || 260;
    const front = mediaUrl(props.frontImage);
    const id = node.id;
    const css = `
.nx-flip-${id}{perspective:1000px}
.nx-flip-${id} .nx-flip-inner{position:relative;width:100%;height:${h}px;transition:transform .6s;transform-style:preserve-3d}
.nx-flip-${id}:hover .nx-flip-inner{transform:rotateY(180deg)}
.nx-flip-${id} .nx-flip-face{position:absolute;inset:0;backface-visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12px;padding:20px;text-align:center}
.nx-flip-${id} .nx-flip-back{transform:rotateY(180deg);background:var(--nx-color-primary);color:#fff}`;
    return (
      <div className={`${className} nx-flip-${id}`}>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="nx-flip-inner">
          <div
            className="nx-flip-face"
            style={{
              background: front
                ? `linear-gradient(rgba(0,0,0,0.25),rgba(0,0,0,0.25)), url("${front}") center/cover`
                : "var(--nx-color-border)",
              color: front ? "#fff" : "var(--nx-color-text)",
            }}
          >
            <strong>{str(props.frontTitle)}</strong>
          </div>
          <div className="nx-flip-face nx-flip-back">
            <strong style={{ marginBottom: 8 }}>{str(props.backTitle)}</strong>
            <span>{str(props.backText)}</span>
          </div>
        </div>
      </div>
    );
  },
});
