"use client";

/**
 * Box-shadow control (spec §4.3). Builds a validated `box-shadow` string from
 * x/y/blur/spread/color/inset. `buildShadow` is exported for unit testing.
 */
import { useState } from "react";

import type { ControlProps } from "../types";

export interface ShadowParts {
  x: string;
  y: string;
  blur: string;
  spread: string;
  color: string;
  inset: boolean;
}

const DEFAULTS: ShadowParts = {
  x: "0",
  y: "4",
  blur: "8",
  spread: "0",
  color: "#00000033",
  inset: false,
};

export function buildShadow(p: ShadowParts): string {
  return `${p.inset ? "inset " : ""}${p.x}px ${p.y}px ${p.blur}px ${p.spread}px ${p.color}`;
}

export function BoxShadowControl({ onChange, label }: ControlProps) {
  const [s, setS] = useState<ShadowParts>(DEFAULTS);
  const emit = (next: ShadowParts) => {
    setS(next);
    onChange(buildShadow(next));
  };
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <div style={{ display: "flex", gap: 4 }}>
        {(["x", "y", "blur", "spread"] as const).map(k => (
          <input
            key={k}
            aria-label={`Shadow ${k}`}
            type="number"
            value={s[k]}
            onChange={e => emit({ ...s, [k]: e.target.value })}
          />
        ))}
        <input
          aria-label="Shadow color"
          type="color"
          value={s.color.slice(0, 7)}
          onChange={e => emit({ ...s, color: e.target.value })}
        />
        <label
          className="nx-pb-control-label"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <input
            type="checkbox"
            aria-label="Shadow inset"
            checked={s.inset}
            onChange={e => emit({ ...s, inset: e.target.checked })}
          />
          inset
        </label>
      </div>
    </div>
  );
}
