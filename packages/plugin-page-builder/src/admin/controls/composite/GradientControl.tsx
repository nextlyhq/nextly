"use client";

/** Two-stop linear-gradient picker → writes a `linear-gradient(...)` string. */
import { useState } from "react";

import type { ControlProps } from "../types";

interface G {
  c1: string;
  c2: string;
  angle: string;
}
const DEFAULT: G = { c1: "#4f46e5", c2: "#0ea5e9", angle: "90" };

export function buildGradient(g: G): string {
  return `linear-gradient(${g.angle}deg, ${g.c1}, ${g.c2})`;
}

export function GradientControl({ value, onChange, label }: ControlProps) {
  const [g, setG] = useState<G>(DEFAULT);
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
