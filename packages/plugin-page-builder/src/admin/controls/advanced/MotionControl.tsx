"use client";

/** Entrance-motion editor (spec §5): animation + duration + delay → node.motion. */
import { MOTION_ANIMATIONS, type MotionConfig } from "../../../core/motion";
import type { ControlProps } from "../types";

export function MotionControl({ value, onChange }: ControlProps) {
  const m = (value as MotionConfig | undefined) ?? {};
  const set = (patch: Partial<MotionConfig>) => onChange({ ...m, ...patch });
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <select
        aria-label="Entrance animation"
        value={m.entrance ?? "none"}
        onChange={e => set({ entrance: e.target.value })}
      >
        {MOTION_ANIMATIONS.map(a => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 4 }}>
        <input
          aria-label="Motion duration"
          placeholder="600ms"
          value={m.duration ?? ""}
          onChange={e => set({ duration: e.target.value })}
        />
        <input
          aria-label="Motion delay"
          placeholder="0ms"
          value={m.delay ?? ""}
          onChange={e => set({ delay: e.target.value })}
        />
      </div>
    </div>
  );
}
