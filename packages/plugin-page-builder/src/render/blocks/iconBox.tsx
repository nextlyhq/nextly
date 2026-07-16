import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { iconByName } from "./iconRegistry";
import { safeUrl, str } from "./util";

/** Icon + title + description card, with the icon at top / left / right. */
export const iconBox = defineBlock({
  type: "core/icon-box",
  version: 1,
  label: "Icon Box",
  icon: "Award",
  category: "content",
  defaultProps: {
    icon: "Star",
    title: "Feature title",
    description: "Short supporting description for this feature.",
    iconPosition: "top",
    link: { href: "" },
  },
  contentFields: [
    { name: "icon", type: "icon", label: "Icon" },
    { name: "title", type: "text", label: "Title", bindable: true },
    {
      name: "description",
      type: "textarea",
      label: "Description",
      bindable: true,
    },
    {
      name: "iconPosition",
      type: "select",
      label: "Icon position",
      options: ["top", "left", "right"].map(v => ({ value: v, label: v })),
    },
    { name: "link", type: "link", label: "Link (optional)" },
  ],
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
    const Cmp = iconByName(str(props.icon) || undefined);
    const title = str(props.title);
    const desc = str(props.description);
    const pos = props.iconPosition;
    const row = pos === "left" || pos === "right";
    const link = props.link as { href?: string } | undefined;
    const href = safeUrl(link?.href);
    const style: CSSProperties = {
      display: "flex",
      flexDirection: row ? (pos === "right" ? "row-reverse" : "row") : "column",
      alignItems: row ? "flex-start" : "center",
      gap: 12,
      textAlign: row ? "left" : "center",
    };
    const body = (
      <>
        <Cmp width={40} height={40} style={{ flexShrink: 0 }} aria-hidden />
        <div>
          {title ? <h3 style={{ margin: "0 0 6px" }}>{title}</h3> : null}
          {desc ? <p style={{ margin: 0 }}>{desc}</p> : null}
        </div>
      </>
    );
    return href ? (
      <a
        className={className}
        href={href}
        style={{ ...style, color: "inherit", textDecoration: "none" }}
      >
        {body}
      </a>
    ) : (
      <div className={className} style={style}>
        {body}
      </div>
    );
  },
});
