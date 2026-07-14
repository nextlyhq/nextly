"use client";

/**
 * Unit-aware numeric control (spec §4.3). Replaces the px-only spacing emitter for
 * dimension-style keys: value + unit dropdown, negatives allowed. The parse/format
 * logic is exported so it can be unit-tested without a DOM.
 */
import type { ControlProps } from "../types";

const UNITS = ["px", "%", "rem", "em", "vw", "vh"];

export function parseUnit(v: unknown): { n: string; u: string } {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  const m = s.match(/^(-?\d*\.?\d*)(px|%|rem|em|vw|vh)?$/);
  return m ? { n: m[1] ?? "", u: m[2] ?? "px" } : { n: "", u: "px" };
}

export function formatUnit(n: string, u: string): string {
  return n === "" ? "" : `${n}${u}`;
}

export function UnitControl({ value, onChange, label }: ControlProps) {
  const { n, u } = parseUnit(value);
  const emit = (num: string, unit: string) => onChange(formatUnit(num, unit));
  return (
    <label style={{ display: "grid", gap: 4 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <span style={{ display: "flex", gap: 4 }}>
        <input
          type="number"
          value={n}
          aria-label={label ?? "Value"}
          onChange={e => emit(e.target.value, u)}
        />
        <select
          value={u}
          aria-label="Unit"
          onChange={e => emit(n, e.target.value)}
        >
          {UNITS.map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
