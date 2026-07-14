import type { CSSProperties } from "react";

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
    variant: "fill",
    width: "auto",
    rel: "",
  },
  contentFields: [
    { name: "text", type: "text", label: "Label", bindable: true },
    { name: "link", type: "link", label: "Link" },
    {
      name: "variant",
      type: "select",
      label: "Style",
      options: [
        { value: "fill", label: "Fill" },
        { value: "outline", label: "Outline" },
      ],
    },
    {
      name: "width",
      type: "select",
      label: "Width",
      options: [
        { value: "auto", label: "Auto" },
        { value: "25%", label: "25%" },
        { value: "50%", label: "50%" },
        { value: "75%", label: "75%" },
        { value: "100%", label: "100%" },
      ],
    },
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
    { name: "rel", type: "text", label: "Link Rel (e.g. nofollow)" },
  ],
  supports: {
    typography: true,
    color: { text: true, background: true },
    border: true,
    shadow: true,
    spacing: true,
    dimensions: { width: true },
    interactions: { hover: true, transition: true },
    visibility: true,
  },
  render: ({ props, className }) => {
    const link = (props.link ?? {}) as { href?: string; target?: string };
    const href = safeUrl(link.href);
    const text = str(props.text, "Button");
    const iconName = str(props.icon);
    const Ico = iconName ? iconByName(iconName) : null;
    const after = props.iconPosition === "after";
    const outline = props.variant === "outline";
    const width = str(props.width, "auto");

    const style: CSSProperties = {
      ...(Ico ? { display: "inline-flex", alignItems: "center", gap: 8 } : {}),
      ...(width !== "auto"
        ? { width, textAlign: "center", justifyContent: "center" }
        : {}),
      ...(outline
        ? { background: "transparent", border: "2px solid currentColor" }
        : {}),
    };
    const hasStyle = Object.keys(style).length > 0;
    const content = (
      <>
        {Ico && !after ? <Ico width={16} height={16} aria-hidden /> : null}
        {text}
        {Ico && after ? <Ico width={16} height={16} aria-hidden /> : null}
      </>
    );
    if (!href) {
      return (
        <button
          className={className}
          type="button"
          style={hasStyle ? style : undefined}
        >
          {content}
        </button>
      );
    }
    const target = link.target || undefined;
    const rel =
      str(props.rel) ||
      (target === "_blank" ? "noopener noreferrer" : undefined);
    return (
      <a
        className={className}
        href={href}
        target={target}
        rel={rel}
        style={hasStyle ? style : undefined}
      >
        {content}
      </a>
    );
  },
});
