"use client";

/** Two-stop linear-gradient picker → writes a `linear-gradient(...)` string. */
import { useEffect, useState } from "react";

import type { ControlProps } from "../types";

interface G {
  c1: string;
  c2: string;
  angle: string;
}
// Page-content gradient defaults fed to native <input type="color"> pickers, which require concrete hex.
const DEFAULT: G = { c1: "#4f46e5", c2: "#0ea5e9", angle: "90" }; // design-lint-ok: color-picker default value

const GRADIENT_RE = /linear-gradient\((\d+)deg,\s*([^,]+),\s*([^)]+)\)/;

/** Parse a stored `linear-gradient(...)` string back into stops, or fall back to DEFAULT. */
function parseGradient(value: unknown): G {
  if (typeof value === "string") {
    const m = value.match(GRADIENT_RE);
    if (m) return { angle: m[1], c1: m[2].trim(), c2: m[3].trim() };
  }
  return DEFAULT;
}

export function buildGradient(g: G): string {
  return `linear-gradient(${g.angle}deg, ${g.c1}, ${g.c2})`;
}

export function GradientControl({ value, onChange, label }: ControlProps) {
  const [g, setG] = useState<G>(() => parseGradient(value));
  // Resync when a different block/value loads, so editing an existing gradient
  // starts from the saved stops rather than the defaults.
  useEffect(() => {
    setG(parseGradient(value));
  }, [value]);
  const emit = (next: G) => {
    setG(next);
    onChange(buildGradient(next));
  };
  const has = typeof value === "string" && value !== "";
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="color"
          aria-label="Gradient start"
          value={g.c1}
          onChange={e => emit({ ...g, c1: e.target.value })}
        />
        <input
          type="color"
          aria-label="Gradient end"
          value={g.c2}
          onChange={e => emit({ ...g, c2: e.target.value })}
        />
        <input
          type="number"
          aria-label="Gradient angle"
          style={{ width: 64 }}
          value={g.angle}
          onChange={e => emit({ ...g, angle: e.target.value })}
        />
        <span>deg</span>
        {has ? (
          <button
            type="button"
            className="nx-pb-icon-btn"
            aria-label="Clear gradient"
            onClick={() => onChange(undefined)}
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
