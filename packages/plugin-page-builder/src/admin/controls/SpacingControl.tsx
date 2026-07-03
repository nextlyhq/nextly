"use client";

/**
 * Edits a BoxSides value (padding/margin) as four px inputs (top/right/bottom/left).
 * Emits a BoxSides object; empty sides are omitted so the compiler skips them.
 */
import { Input } from "@nextlyhq/ui";

import type { BoxSides } from "../../core/types";

import { ControlRow } from "./primitives";
import type { ControlProps } from "./types";

type Side = keyof BoxSides;
const SIDES: { key: Side; label: string }[] = [
  { key: "top", label: "T" },
  { key: "right", label: "R" },
  { key: "bottom", label: "B" },
  { key: "left", label: "L" },
];

function num(v: string | undefined): string {
  if (!v) return "";
  const m = /^(-?\d*\.?\d+)/.exec(v);
  return m ? m[1] : "";
}

export function SpacingControl({ value, onChange, label }: ControlProps) {
  const sides = (value ?? {}) as BoxSides;
  const emit = (side: Side, raw: string) => {
    const next: BoxSides = { ...sides };
    if (raw === "") delete next[side];
    else next[side] = `${raw}px`;
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <ControlRow label={label}>
      <div style={{ display: "flex", gap: 4 }}>
        {SIDES.map(s => (
          <div key={s.key} style={{ flex: 1, textAlign: "center" }}>
            <Input
              type="number"
              aria-label={`${label ?? "spacing"} ${s.key}`}
              value={num(sides[s.key])}
              onChange={e => emit(s.key, e.target.value)}
            />
            <span style={{ fontSize: 10, color: "#9ca3af" }}>{s.label}</span>
          </div>
        ))}
      </div>
    </ControlRow>
  );
}
