"use client";

/**
 * Structured border control (spec §4.3): per-side width + style + color.
 * Writes a `StyleValues.border` object: `{ width: BoxSides, style, color }`.
 */
import type { ControlProps } from "../types";

type Border = {
  width?: { top?: string; right?: string; bottom?: string; left?: string };
  style?: string;
  color?: string;
};

const STYLES = ["none", "solid", "dashed", "dotted", "double"];

export function BorderControl({ value, onChange, label }: ControlProps) {
  const b = (value as Border | undefined) ?? {};
  const set = (patch: Partial<Border>) => onChange({ ...b, ...patch });
  const setWidth = (side: "top" | "right" | "bottom" | "left", v: string) =>
    set({ width: { ...(b.width ?? {}), [side]: v ? `${v}px` : undefined } });
  const num = (s?: string) => (s ? s.replace("px", "") : "");

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <div style={{ display: "flex", gap: 4 }}>
        <select
          aria-label="Border style"
          value={b.style ?? "none"}
          onChange={e => set({ style: e.target.value })}
        >
          {STYLES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          aria-label="Border color"
          type="color"
          value={b.color ?? "#000000"}
          onChange={e => set({ color: e.target.value })}
        />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {(["top", "right", "bottom", "left"] as const).map(side => (
          <input
            key={side}
            aria-label={`Border ${side}`}
            type="number"
            placeholder={side[0].toUpperCase()}
            value={num(b.width?.[side])}
            onChange={e => setWidth(side, e.target.value)}
          />
        ))}
      </div>
    </div>
  );
}
