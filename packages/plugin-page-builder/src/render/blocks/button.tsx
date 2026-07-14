import { defineBlock } from "../../core/registry";

import { iconByName } from "./iconRegistry";
import { safeUrl, str } from "./util";

export const button = defineBlock({
  type: "core/button",
  version: 1,
  label: "Button",
  icon: "MousePointerClick",
  category: "basic",
  defaultProps: {
    text: "Click me",
    link: { href: "", target: "" },
    icon: "",
    iconPosition: "before",
  },
  contentFields: [
    { name: "text", type: "text", label: "Label", bindable: true },
    { name: "link", type: "link", label: "Link" },
    { name: "icon", type: "icon", label: "Icon (optional)", default: "" },
    {
      name: "iconPosition",
      type: "select",
      label: "Icon position",
      options: [
        { value: "before", label: "Before" },
        { value: "after", label: "After" },
      ],
    },
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
    const text = str(props.text, "Button");
    const iconName = str(props.icon);
    const Ico = iconName ? iconByName(iconName) : null;
    const after = props.iconPosition === "after";
    const style = Ico
      ? { display: "inline-flex", alignItems: "center", gap: 8 }
      : undefined;
    const content = (
      <>
        {Ico && !after ? <Ico width={16} height={16} aria-hidden /> : null}
        {text}
        {Ico && after ? <Ico width={16} height={16} aria-hidden /> : null}
      </>
    );
    if (!href) {
      return (
        <button className={className} type="button" style={style}>
          {content}
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
        style={style}
      >
        {content}
      </a>
    );
  },
});
