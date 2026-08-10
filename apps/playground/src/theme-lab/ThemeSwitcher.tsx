"use client";

/**
 * The theme lab's switcher panel: three independent axes over the admin
 * shell it floats on top of -- theme, density, and light/dark mode.
 *
 * Each theme is shown as the same preview card the gallery uses, pinned to
 * whichever mode the admin is currently in. A name says nothing about what a
 * theme looks like, and a swatch strip says nothing about whether it WORKS --
 * the card shows the primitives (nav rows, checkbox, input) where themes
 * actually fail, so a choice can be narrowed here and compared in full at
 * /theme-lab.
 *
 * No search: nine themes fit without one, and a filter over nine rows costs
 * more attention than it saves.
 */
import { useTheme } from "@nextlyhq/admin";
import Link from "next/link";
import { useState } from "react";

import { CONTRAST_REPORT } from "./contrast-report.generated";
import type { CssVars } from "./ThemePreviewCard";
import { ThemePreviewCard } from "./ThemePreviewCard";
import { NEXTLY_THEMES, TWEAKCN_THEMES } from "./themes";
import type { DensityId, ThemeDefinition } from "./types";
import { SHIPPED_THEME, useThemeLab } from "./use-theme-lab";

// Mirrors the DensityId union in types.ts. That is a compile-time type with
// no runtime array of its own to iterate, so the options a <select> offers
// are declared here the same way the densities.css test already enumerates
// them.
const DENSITIES: DensityId[] = ["compact", "default", "comfortable"];

/**
 * Third-party reference themes keep their own group so the list itself
 * communicates that they are comparison material, not Nextly identity
 * candidates.
 */
const GROUPS: { label: string; themes: ThemeDefinition[] }[] = [
  { label: "Nextly originals", themes: NEXTLY_THEMES },
  { label: "tweakcn presets", themes: TWEAKCN_THEMES },
];

/**
 * Styled entirely with hardcoded inline colors rather than the admin's own
 * design tokens -- an approved, deliberate exception to the project's
 * token-driven styling rule, scoped to this one control. Every other axis
 * this panel exposes changes what the admin's tokens resolve to; a control
 * built from those same tokens would go low-contrast on Calm or turn
 * monospace green on Terminal right as it applied the change, which means
 * the one piece of UI whose job is to show what just happened would be the
 * first thing to become unreadable doing it.
 *
 * The exception is what makes the swatches trustworthy as well: they are the
 * only theme-coloured thing in the panel, so a swatch that looks wrong is the
 * theme being wrong rather than the panel inheriting it.
 */
const PANEL_BG = "#111318";
const PANEL_FG = "#e8e8ec";
const PANEL_BORDER = "#3a3d46";
const CONTROL_BG = "#1c1f26";

const panelStyle: CssVars = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 2147483647,
  background: PANEL_BG,
  color: PANEL_FG,
  font: "12px/1.4 ui-monospace, monospace",
  border: `1px solid ${PANEL_BORDER}`,
  borderRadius: 8,
  padding: 12,
  width: 352,
  // The preview cards' own chrome (their border, muted label text, score
  // badge) reads `--nx-*` tokens, which would otherwise resolve to the
  // ADMIN's current theme -- a light border drawn on this deliberately dark
  // panel. Pinning them to the panel's palette here keeps the card a pure
  // function of a theme while its surroundings stay the lab's, not the
  // admin's. Only the tokens the card's chrome reads are pinned; the mode
  // panels set their own inline and are unaffected.
  "--nx-border": PANEL_BORDER,
  "--nx-muted-foreground": "#a2a4ad",
  "--nx-success": "#8fdf8f",
  "--nx-destructive": "#e0b866",
  // Capped against the viewport AND at a fixed ceiling: the theme list is the
  // only part that grows, and letting the panel track the viewport alone
  // would have it swallow a tall screen. The list below takes the leftover
  // space and scrolls on its own, so the controls stay reachable without
  // scrolling the panel itself.
  maxHeight: "min(88vh, 820px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 2px 16px rgba(0, 0, 0, 0.45)",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: CONTROL_BG,
  color: PANEL_FG,
  border: `1px solid ${PANEL_BORDER}`,
  borderRadius: 4,
  padding: "4px 6px",
  fontSize: 12,
  marginTop: 4,
};

const buttonStyle: React.CSSProperties = {
  background: CONTROL_BG,
  color: PANEL_FG,
  border: `1px solid ${PANEL_BORDER}`,
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
};

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const { theme, density, setTheme, setDensity, reset } = useThemeLab();

  // Mode is the third axis but isn't tracked by useThemeLab: the admin
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
        style={{
          ...panelStyle,
          width: "auto",
          maxHeight: "none",
          cursor: "pointer",
        }}
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
          flex: "0 0 auto",
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

      <div
        style={{
          marginTop: 6,
          padding: "2px 6px",
          borderRadius: 4,
          alignSelf: "flex-start",
          flex: "0 0 auto",
          background: failures === 0 ? "#193a1e" : "#3a2e13",
          color: failures === 0 ? "#8fdf8f" : "#e0b866",
        }}
      >
        {failures === 0 ? "WCAG AA: pass" : `WCAG AA: ${failures} failing`}
      </div>

      {/* The only element that grows, so it is the only one that scrolls.
          minHeight:0 is what actually lets it shrink inside the flex column --
          without it a flex item refuses to go below its content height and the
          panel would grow past its own cap instead. */}
      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflowY: "auto",
          marginTop: 8,
        }}
      >
        {/* The shipped theme is a row rather than a preview card: there is no
            ThemeDefinition behind it, and that is the point -- it applies no
            override at all, so what the admin shows is what the product ships.
            First in the list because it is the resting state; comparing a
            candidate is the deliberate act. */}
        <button
          type="button"
          onClick={() => setTheme(SHIPPED_THEME)}
          disabled={theme === SHIPPED_THEME}
          style={{
            ...buttonStyle,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            marginBottom: 12,
            padding: "8px 10px",
            cursor: theme === SHIPPED_THEME ? "default" : "pointer",
            opacity: theme === SHIPPED_THEME ? 1 : 0.85,
          }}
        >
          <span>shipped theme</span>
          <span style={{ opacity: 0.75 }}>
            {theme === SHIPPED_THEME ? "active" : "apply"}
          </span>
        </button>

        {GROUPS.map(group => (
          <div key={group.label}>
            {/* Sticky so the group a card belongs to stays visible while
                  scrolling -- the distinction between a Nextly original and a
                  third-party preset is the one piece of context a card can't
                  carry on its own. */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: PANEL_BG,
                borderBottom: `1px solid ${PANEL_BORDER}`,
                padding: "4px 6px",
              }}
            >
              {/* Dimmed on the text alone. `opacity` on the header itself
                    would take its background down with it, and the cards
                    scrolling underneath would read straight through it. */}
              <span style={{ opacity: 0.75 }}>
                {group.label} ({group.themes.length})
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "8px 0 12px",
              }}
            >
              {group.themes.map(t => (
                <ThemePreviewCard
                  key={t.id}
                  theme={t}
                  size="panel"
                  mode={mode}
                  contrastFailures={CONTRAST_REPORT[t.id]}
                  onApply={setTheme}
                  applied={t.id === theme}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <label style={{ display: "block", marginTop: 8, flex: "0 0 auto" }}>
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

      <label style={{ display: "block", marginTop: 8, flex: "0 0 auto" }}>
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 10,
          flex: "0 0 auto",
        }}
      >
        <button type="button" onClick={reset} style={buttonStyle}>
          reset
        </button>
        {/* The panel narrows a choice; the gallery is where both modes are
            seen at once. */}
        <Link
          href="/theme-lab"
          style={{ color: PANEL_FG, opacity: 0.75, fontSize: 11 }}
        >
          compare all →
        </Link>
      </div>
    </div>
  );
}
