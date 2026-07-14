import { defineBlock } from "../../core/registry";

import { iconByName } from "./iconRegistry";
import { str } from "./util";

/** A labeled progress bar. */
export const progressBar = defineBlock({
  type: "core/progress-bar",
  version: 1,
  label: "Progress Bar",
  icon: "TrendingUp",
  category: "basic",
  defaultProps: { label: "Skill", percent: 70 },
  contentFields: [
    { name: "label", type: "text", label: "Label" },
    { name: "percent", type: "number", label: "Percent (0–100)" },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const pct = Math.min(Math.max(Number(props.percent) || 0, 0), 100);
    return (
      <div className={className}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span>{str(props.label)}</span>
          <span>{pct}%</span>
        </div>
        <div
          style={{
            background: "#e5e7eb",
            borderRadius: 9999,
            height: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{ width: `${pct}%`, height: "100%", background: "#4f46e5" }}
          />
        </div>
      </div>
    );
  },
});

/** A big number with prefix/suffix + label. */
export const counter = defineBlock({
  type: "core/counter",
  version: 1,
  label: "Counter",
  icon: "TrendingUp",
  category: "basic",
  defaultProps: { value: "1000", prefix: "", suffix: "+", label: "Customers" },
  contentFields: [
    { name: "value", type: "text", label: "Number" },
    { name: "prefix", type: "text", label: "Prefix" },
    { name: "suffix", type: "text", label: "Suffix" },
    { name: "label", type: "text", label: "Label" },
  ],
  supports: {
    typography: true,
    color: { text: true },
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => (
    <div className={className} style={{ textAlign: "center" }}>
      <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>
        {str(props.prefix)}
        {str(props.value, "0")}
        {str(props.suffix)}
      </div>
      {props.label ? (
        <div style={{ opacity: 0.75 }}>{str(props.label)}</div>
      ) : null}
    </div>
  ),
});

/** A star rating (value of max). */
export const rating = defineBlock({
  type: "core/rating",
  version: 1,
  label: "Rating",
  icon: "Star",
  category: "basic",
  defaultProps: { value: 4.5, max: 5 },
  contentFields: [
    { name: "value", type: "number", label: "Value" },
    { name: "max", type: "number", label: "Max" },
  ],
  supports: {
    spacing: true,
    visibility: true,
    customCss: true,
    customAttributes: true,
  },
  render: ({ props, className }) => {
    const max = Math.min(Math.max(Number(props.max) || 5, 1), 10);
    const value = Math.min(Math.max(Number(props.value) || 0, 0), max);
    const Star = iconByName("Star");
    return (
      <div
        className={className}
        style={{ display: "inline-flex", gap: 2, color: "#f59e0b" }}
        aria-label={`${value} out of ${max}`}
      >
        {Array.from({ length: max }).map((_, i) => (
          <Star
            key={i}
            width={20}
            height={20}
            fill={i < Math.round(value) ? "currentColor" : "none"}
          />
        ))}
      </div>
    );
  },
});
