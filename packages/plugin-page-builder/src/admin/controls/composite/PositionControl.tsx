"use client";

/**
 * Position control (spec §4.3). Writes a `StyleValues.position` object:
 * `{ type, top, right, bottom, left, zIndex }`.
 */
import type { ControlProps } from "../types";

type Pos = {
  type?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;
};

const TYPES = ["static", "relative", "absolute", "fixed", "sticky"];

export function PositionControl({ value, onChange, label }: ControlProps) {
  const p = (value as Pos | undefined) ?? {};
  const set = (patch: Partial<Pos>) => onChange({ ...p, ...patch });
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <select
        aria-label="Position type"
        value={p.type ?? "static"}
        onChange={e => set({ type: e.target.value })}
      >
        {TYPES.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 4 }}>
        {(["top", "right", "bottom", "left"] as const).map(s => (
          <input
            key={s}
            aria-label={`Offset ${s}`}
            placeholder={s[0].toUpperCase()}
            value={p[s] ?? ""}
            onChange={e => set({ [s]: e.target.value })}
          />
        ))}
        <input
          aria-label="z-index"
          type="number"
          placeholder="z"
          value={p.zIndex ?? ""}
          onChange={e => set({ zIndex: e.target.value })}
        />
      </div>
    </div>
  );
}
