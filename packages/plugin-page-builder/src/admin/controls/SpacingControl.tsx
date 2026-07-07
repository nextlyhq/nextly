"use client";

/**
 * Edits a BoxSides value (padding/margin) as four px inputs (top/right/bottom/left), with a
 * link toggle that edits all four sides together (Elementor-style). Emits a BoxSides object;
 * empty sides are omitted so the compiler skips them.
 */
import { Input } from "@nextlyhq/ui";
import { useState } from "react";

import type { BoxSides } from "../../core/types";
import { Link2 } from "../icons";

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
  const [linked, setLinked] = useState(false);

  const emit = (side: Side, raw: string) => {
    // Linked: write the same value to every side at once.
    if (linked) {
      if (raw === "") return onChange(undefined);
      const all = `${raw}px`;
      return onChange({ top: all, right: all, bottom: all, left: all });
    }
    const next: BoxSides = { ...sides };
    if (raw === "") delete next[side];
    else next[side] = `${raw}px`;
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <ControlRow label={label}>
      <div className="nx-pb-box">
        {SIDES.map(s => (
          <div key={s.key} className="nx-pb-box-side">
            <Input
              type="number"
              aria-label={`${label ?? "spacing"} ${s.key}`}
              value={num(sides[s.key])}
              onChange={e => emit(s.key, e.target.value)}
            />
            <span>{s.label}</span>
          </div>
        ))}
        <button
          type="button"
          className="nx-pb-box-link"
          aria-label="Link all sides"
          aria-pressed={linked}
          title="Edit all sides together"
          onClick={() => setLinked(l => !l)}
        >
          <Link2 size={15} aria-hidden />
        </button>
      </div>
    </ControlRow>
  );
}
