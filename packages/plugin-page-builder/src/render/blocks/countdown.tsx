import type { ReactNode } from "react";

import { defineBlock } from "../../core/registry";

import { str } from "./util";

/**
 * Countdown to a target datetime. The remaining time is computed at render (server) — a
 * correct snapshot on page load. Live ticking is an optional client-runtime enhancement.
 */
export const countdown = defineBlock({
  type: "core/countdown",
  version: 1,
  label: "Countdown",
  icon: "Clock",
  category: "basic",
  defaultProps: { target: "2027-01-01T00:00:00Z" },
  contentFields: [
    {
      name: "target",
      type: "text",
      label: "Target date/time (ISO)",
      placeholder: "2027-01-01T00:00:00Z",
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
    const t = Date.parse(str(props.target));
    let d = 0;
    let h = 0;
    let m = 0;
    let s = 0;
    if (!Number.isNaN(t)) {
      let diff = Math.max(0, Math.floor((t - Date.now()) / 1000));
      d = Math.floor(diff / 86400);
      diff %= 86400;
      h = Math.floor(diff / 3600);
      diff %= 3600;
      m = Math.floor(diff / 60);
      s = diff % 60;
    }
    const box = (n: number, label: string): ReactNode => (
      <div style={{ textAlign: "center", minWidth: 56 }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{n}</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      </div>
    );
    return (
      <div className={className} style={{ display: "flex", gap: 16 }}>
        {box(d, "Days")}
        {box(h, "Hours")}
        {box(m, "Minutes")}
        {box(s, "Seconds")}
      </div>
    );
  },
});
