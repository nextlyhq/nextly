"use client";

/**
 * The theme lab's switcher panel: three independent axes over the admin
 * shell it floats on top of -- theme, density, and light/dark mode.
 * Replaces InterimThemeSwitcher, which only covered the Nextly theme axis.
 */
import { useTheme } from "@nextlyhq/admin";
import { useState } from "react";

import { CONTRAST_REPORT } from "./contrast-report.generated";
import { NEXTLY_THEMES } from "./themes";
import { TWEAKCN_THEMES } from "./themes/tweakcn.generated";
import type { DensityId } from "./types";
import { useThemeLab } from "./use-theme-lab";

// Mirrors the DensityId union in types.ts. That is a compile-time type with
// no runtime array of its own to iterate, so the options a <select> offers
// are declared here the same way the densities.css test already enumerates
// them.
const DENSITIES: DensityId[] = ["compact", "default", "comfortable"];

/**
 * Styled entirely with hardcoded inline colors rather than the admin's own
 * design tokens -- an approved, deliberate exception to the project's
 * token-driven styling rule, scoped to this one control. Every other axis
 * this panel exposes changes what the admin's tokens resolve to; a control
 * built from those same tokens would go low-contrast on Calm or turn
 * monospace green on Terminal right as it applied the change, which means
 * the one piece of UI whose job is to show what just happened would be the
 * first thing to become unreadable doing it.
 */
const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 2147483647,
  background: "#111318",
  color: "#e8e8ec",
  font: "12px/1.4 ui-monospace, monospace",
  border: "1px solid #3a3d46",
  borderRadius: 8,
  padding: 12,
  minWidth: 260,
  maxHeight: "80vh",
  overflowY: "auto",
  boxShadow: "0 2px 16px rgba(0, 0, 0, 0.45)",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "#1c1f26",
  color: "#e8e8ec",
  border: "1px solid #3a3d46",
  borderRadius: 4,
  padding: "4px 6px",
  fontSize: 12,
  marginTop: 4,
};

const buttonStyle: React.CSSProperties = {
  background: "#1c1f26",
  color: "#e8e8ec",
  border: "1px solid #3a3d46",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
};

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const { theme, density, setTheme, setDensity, reset } = useThemeLab();

  // Mode is the fourth axis but isn't tracked by useThemeLab: the admin
  // already owns light/dark through next-themes (re-exported from
  // @nextlyhq/admin), which persists the choice under its own storage key
  // and keeps every `.nextly-admin` container's `dark` class in sync --
  // including across the shell's route remounts -- via the ThemeSync
  // component ThemeProvider already mounts. Calling setTheme here drives
  // that existing mechanism directly instead of a second one that could
  // disagree with it.
  const { resolvedTheme, setTheme: setMode } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";

  if (!open) {
    return (
      <button
        type="button"
        style={{ ...panelStyle, minWidth: 0, cursor: "pointer" }}
        onClick={() => setOpen(true)}
      >
        theme lab
      </button>
    );
  }

  const failures = CONTRAST_REPORT[theme] ?? 0;

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>theme lab</strong>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ ...buttonStyle, padding: "0 6px" }}
          aria-label="Close theme lab"
        >
          x
        </button>
      </div>

      <label style={{ display: "block", marginTop: 8 }}>
        theme
        <select
          value={theme}
          onChange={e => setTheme(e.target.value)}
          style={selectStyle}
        >
          {/* Third-party reference themes get their own group so the list
              itself communicates that they're comparison material, not
              Nextly identity candidates. */}
          <optgroup label={`Nextly originals (${NEXTLY_THEMES.length})`}>
            {NEXTLY_THEMES.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label={`tweakcn presets (${TWEAKCN_THEMES.length})`}>
            {TWEAKCN_THEMES.map(t => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <div
        style={{
          marginTop: 6,
          padding: "2px 6px",
          borderRadius: 4,
          display: "inline-block",
          background: failures === 0 ? "#193a1e" : "#3a2e13",
          color: failures === 0 ? "#8fdf8f" : "#e0b866",
        }}
      >
        {failures === 0 ? "WCAG AA: pass" : `WCAG AA: ${failures} failing`}
      </div>

      <label style={{ display: "block", marginTop: 8 }}>
        density
        <select
          value={density}
          onChange={e => setDensity(e.target.value as DensityId)}
          style={selectStyle}
        >
          {DENSITIES.map(id => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "block", marginTop: 8 }}>
        mode
        <select
          value={mode}
          onChange={e => setMode(e.target.value)}
          style={selectStyle}
        >
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
      </label>

      <button
        type="button"
        onClick={reset}
        style={{ ...buttonStyle, marginTop: 10, width: "100%" }}
      >
        reset
      </button>
    </div>
  );
}
