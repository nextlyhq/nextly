import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { safeUrl, str } from "./util";

const BTN_STYLE: CSSProperties = {
  display: "inline-block",
  padding: "10px 18px",
  borderRadius: "8px",
  background: "var(--nx-color-primary)",
  color: "#fff",
  textDecoration: "none",
  border: "none",
  cursor: "pointer",
  font: "inherit",
};

/** A row of buttons sharing alignment + gap. */
export const buttonGroup = defineBlock({
  type: "core/button-group",
  version: 1,
  label: "Button Group",
  icon: "MousePointerClick",
  category: "basic",
  defaultProps: {
    align: "left",
    buttons: [
      { text: "Get started", link: { href: "#" } },
      { text: "Learn more", link: {} },
    ],
  },
  contentFields: [
    {
      name: "align",
      type: "select",
      label: "Align",
      options: ["left", "center", "right"].map(a => ({ value: a, label: a })),
    },
    {
      name: "buttons",
      type: "repeater",
      label: "Buttons",
      addLabel: "Add button",
      itemFields: [
        { name: "text", type: "text", label: "Label" },
        { name: "link", type: "link", label: "Link" },
      ],
    },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const buttons = Array.isArray(props.buttons) ? props.buttons : [];
    const justify =
      props.align === "center"
        ? "center"
        : props.align === "right"
          ? "flex-end"
          : "flex-start";
    return (
      <div
        className={className}
        style={{
          display: "flex",
          gap: "10px",
          justifyContent: justify,
          flexWrap: "wrap",
        }}
      >
        {buttons.map((raw, i) => {
          const b = (raw ?? {}) as Record<string, unknown>;
          const text = str(b.text, "Button");
          const link = b.link as Record<string, unknown> | undefined;
          const href = safeUrl(link?.href);
          return href ? (
            <a key={i} href={href} style={BTN_STYLE}>
              {text}
            </a>
          ) : (
            <button key={i} type="button" style={BTN_STYLE}>
              {text}
            </button>
          );
        })}
      </div>
    );
  },
});
