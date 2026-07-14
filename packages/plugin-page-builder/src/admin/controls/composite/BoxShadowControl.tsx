"use client";

/**
 * Box-shadow control (spec §4.3). Builds a validated `box-shadow` string from
 * x/y/blur/spread/color/inset. `buildShadow` is exported for unit testing.
 */
import { useEffect, useState } from "react";

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
  color: "#00000033", // design-lint-ok: black shadow default fed to the color picker
  inset: false,
};

const SHADOW_RE =
  /^(inset\s+)?(-?\d+)px\s+(-?\d+)px\s+(\d+)px\s+(-?\d+)px\s+(.+)$/;

/** Parse a stored `box-shadow` string back into parts, or fall back to DEFAULTS. */
export function parseShadow(value: unknown): ShadowParts {
  if (typeof value === "string") {
    const m = value.trim().match(SHADOW_RE);
    if (m) {
      return {
        inset: Boolean(m[1]),
        x: m[2],
        y: m[3],
        blur: m[4],
        spread: m[5],
        color: m[6].trim(),
      };
    }
  }
  return DEFAULTS;
}

export function buildShadow(p: ShadowParts): string {
  return `${p.inset ? "inset " : ""}${p.x}px ${p.y}px ${p.blur}px ${p.spread}px ${p.color}`;
}

export function BoxShadowControl({ value, onChange, label }: ControlProps) {
  const [s, setS] = useState<ShadowParts>(() => parseShadow(value));
  // Resync from the stored value so editing an existing shadow starts from its
  // real offsets/blur/spread/color rather than the defaults.
  useEffect(() => {
    setS(parseShadow(value));
  }, [value]);
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
          onChange={e => {
            // Native color pickers only handle 6-digit hex; retain any 8-digit
            // alpha suffix so changing the hue doesn't drop the shadow's opacity.
            const alpha = s.color.length > 7 ? s.color.slice(7) : "";
            emit({ ...s, color: e.target.value + alpha });
          }}
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
