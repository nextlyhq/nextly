"use client";

/** Select an icon from the curated lucide set (shared with icon-bearing blocks). */
import { ICON_NAMES } from "../../../render/blocks/iconRegistry";
import type { ControlProps } from "../types";

export function IconPickerControl({ value, onChange, label }: ControlProps) {
  const v = typeof value === "string" ? value : "Star";
  return (
    <label style={{ display: "grid", gap: 4 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <select
        value={v}
        aria-label={label ?? "Icon"}
        onChange={e => onChange(e.target.value)}
      >
        {ICON_NAMES.map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
