import type { CSSProperties } from "react";

import { defineBlock } from "../../core/registry";

import { safeUrl, str } from "./util";

const BTN: CSSProperties = {
  display: "inline-block",
  padding: "10px 20px",
  borderRadius: 8,
  background: "var(--nx-color-primary)",
  color: "#fff",
  textDecoration: "none",
  marginTop: 8,
};

/** A single pricing plan card with a feature list + CTA. */
export const pricingTable = defineBlock({
  type: "core/pricing-table",
  version: 1,
  label: "Pricing Table",
  icon: "Award",
  category: "content",
  defaultProps: {
    title: "Pro",
    price: "$29",
    period: "/mo",
    buttonText: "Choose plan",
    link: { href: "#" },
    features: [{ text: "Everything in Basic" }, { text: "Priority support" }],
  },
  contentFields: [
    { name: "title", type: "text", label: "Plan name" },
    { name: "price", type: "text", label: "Price" },
    { name: "period", type: "text", label: "Period" },
    {
      name: "features",
      type: "repeater",
      label: "Features",
      addLabel: "Add feature",
      itemFields: [{ name: "text", type: "text", label: "Feature" }],
    },
    { name: "buttonText", type: "text", label: "Button label" },
    { name: "link", type: "link", label: "Button link" },
  ],
  supports: {
    color: { text: true, background: true },
    spacing: true,
    border: true,
    shadow: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const features = Array.isArray(props.features) ? props.features : [];
    const href = safeUrl((props.link as { href?: string })?.href);
    return (
      <div
        className={className}
        style={{
          border: "1px solid var(--nx-color-border)",
          borderRadius: 12,
          padding: 24,
          textAlign: "center",
          maxWidth: 320,
        }}
      >
        <h3 style={{ margin: "0 0 4px" }}>{str(props.title)}</h3>
        <div style={{ fontSize: 36, fontWeight: 700 }}>
          {str(props.price)}
          <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}>
            {str(props.period)}
          </span>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: "16px 0" }}>
          {features.map((raw, i) => (
            <li key={i} style={{ padding: "4px 0" }}>
              {str((raw as Record<string, unknown>)?.text)}
            </li>
          ))}
        </ul>
        {href ? (
          <a href={href} style={BTN}>
            {str(props.buttonText, "Choose")}
          </a>
        ) : null}
      </div>
    );
  },
});

/** A menu/price list: name … price + description. */
export const priceList = defineBlock({
  type: "core/price-list",
  version: 1,
  label: "Price List",
  icon: "Award",
  category: "content",
  defaultProps: {
    items: [
      { name: "Espresso", price: "$3", description: "Rich and bold" },
      { name: "Latte", price: "$4.5", description: "Smooth and milky" },
    ],
  },
  contentFields: [
    {
      name: "items",
      type: "repeater",
      label: "Items",
      addLabel: "Add item",
      itemFields: [
        { name: "name", type: "text", label: "Name" },
        { name: "price", type: "text", label: "Price" },
        { name: "description", type: "text", label: "Description" },
      ],
    },
  ],
  supports: {
    typography: true,
    color: { text: true },
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    return (
      <div className={className} style={{ display: "grid", gap: 12 }}>
        {items.map((raw, i) => {
          const it = (raw ?? {}) as Record<string, unknown>;
          return (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 600,
                }}
              >
                <span>{str(it.name)}</span>
                <span>{str(it.price)}</span>
              </div>
              {it.description ? (
                <div style={{ opacity: 0.7, fontSize: "0.9em" }}>
                  {str(it.description)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  },
});
