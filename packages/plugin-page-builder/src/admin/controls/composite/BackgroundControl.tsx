"use client";

/**
 * Background control (spec §4.3). Writes a `StyleValues.backgroundImageObj`:
 * `{ url, position, size, repeat, attachment }`. Uses a URL input for the image
 * source (the media-library picker is a later refinement; a media URL pastes here).
 */
import type { ControlProps } from "../types";

type Bg = {
  url?: string;
  position?: string;
  size?: string;
  repeat?: string;
  attachment?: string;
};

export function BackgroundControl({ value, onChange, label }: ControlProps) {
  const bg = (value as Bg | undefined) ?? {};
  const set = (patch: Partial<Bg>) => onChange({ ...bg, ...patch });
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {label ? <span className="nx-pb-control-label">{label}</span> : null}
      <input
        aria-label="Background image URL"
        placeholder="https://… or /image.jpg"
        value={bg.url ?? ""}
        onChange={e => set({ url: e.target.value })}
      />
      <div style={{ display: "flex", gap: 4 }}>
        <select
          aria-label="Background size"
          value={bg.size ?? "cover"}
          onChange={e => set({ size: e.target.value })}
        >
          {["auto", "cover", "contain"].map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          aria-label="Background repeat"
          value={bg.repeat ?? "no-repeat"}
          onChange={e => set({ repeat: e.target.value })}
        >
          {["no-repeat", "repeat", "repeat-x", "repeat-y"].map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          aria-label="Background position"
          value={bg.position ?? "center"}
          onChange={e => set({ position: e.target.value })}
        >
          {["center", "top", "bottom", "left", "right"].map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          aria-label="Background attachment"
          value={bg.attachment ?? "scroll"}
          onChange={e => set({ attachment: e.target.value })}
        >
          {["scroll", "fixed", "local"].map(x => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
