"use client";

/**
 * Range slider control (spec §4.3) — used for opacity / z-index / filter amounts.
 * `field.default`/`field.options` can carry min/max/step via placeholder metadata;
 * defaults suit opacity (0–1).
 */
import type { ControlProps } from "../types";

export function SliderControl({ value, onChange, label, field }: ControlProps) {
  const min = Number(field?.default ?? 0);
  const max = 1;
  const step = 0.01;
  const v =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  return (
    <label style={{ display: "grid", gap: 4 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v === "" ? String(max) : v}
        aria-label={label ?? "Slider"}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}
