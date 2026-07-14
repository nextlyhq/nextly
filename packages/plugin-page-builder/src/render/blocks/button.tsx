import { defineBlock } from "../../core/registry";

import { safeUrl } from "./util";

export const button = defineBlock({
  type: "core/button",
  version: 1,
  label: "Button",
  icon: "MousePointerClick",
  category: "basic",
  defaultProps: { text: "Click me", link: { href: "", target: "" } },
  contentFields: [
    { name: "text", type: "text", label: "Label", bindable: true },
    { name: "link", type: "link", label: "Link" },
  ],
  supports: {
    typography: true,
    color: { text: true, background: true },
    border: true,
    shadow: true,
    spacing: true,
    dimensions: { width: true },
    interactions: { hover: true, transition: true },
  },
  render: ({ props, className }) => {
    const link = (props.link ?? {}) as { href?: string; target?: string };
    const href = safeUrl(link.href);
    const text = String(props.text ?? "Button");
    if (!href) {
      return (
        <button className={className} type="button">
          {text}
        </button>
      );
    }
    const target = link.target || undefined;
    return (
      <a
        className={className}
        href={href}
        target={target}
        rel={target === "_blank" ? "noopener noreferrer" : undefined}
      >
        {text}
      </a>
    );
  },
});
