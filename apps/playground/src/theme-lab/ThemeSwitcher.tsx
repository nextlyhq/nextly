"use client";

/**
 * The theme lab's switcher panel: three independent axes over the admin
 * shell it floats on top of -- theme, density, and light/dark mode.
 * Replaces InterimThemeSwitcher, which only covered the Nextly theme axis.
 *
 * Themes are picked from a list of rows rather than a <select> because a
 * dropdown of 54 labels says nothing about what any of them look like: the
 * whole point of the lab is comparing appearances, and a name is the one
 * property of a theme that carries none of it. Each row previews the palette
 * and says in a line what the theme is doing differently, so a choice can be
 * narrowed before it is applied rather than by applying all 54 in turn.
 */
import { useTheme } from "@nextlyhq/admin";
import { useState } from "react";

import { CONTRAST_REPORT } from "./contrast-report.generated";
import { NEXTLY_THEMES } from "./themes";
import { TWEAKCN_THEMES } from "./themes/tweakcn.generated";
import type { DensityId, ThemeDefinition, ThemeTokens } from "./types";
import { useThemeLab } from "./use-theme-lab";

// Mirrors the DensityId union in types.ts. That is a compile-time type with
// no runtime array of its own to iterate, so the options a <select> offers
// are declared here the same way the densities.css test already enumerates
// them.
const DENSITIES: DensityId[] = ["compact", "default", "comfortable"];

/**
 * The five tokens the swatch strip previews, in the order they are drawn.
 *
 * Chosen to answer "what will this look like" in one glance rather than to be
 * a representative sample of the token set: the two surfaces a screen is
 * mostly made of (page and card), the two colours laid on top of them
 * (primary and accent), and the rule colour that decides whether the whole
 * interface reads as crisp or as washed out.
 */
const SWATCH_TOKENS = ["background", "card", "primary", "accent", "border"];

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
const SELECTED_BG = "#243044";
const SELECTED_BORDER = "#5b7fb8";

const panelStyle: React.CSSProperties = {
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
  width: 320,
  // Capped against the viewport AND at a fixed ceiling: the theme list is the
  // only part that grows, and letting the panel track the viewport alone
  // would have it swallow a tall screen. The list below takes the leftover
  // space and scrolls on its own, so the controls stay reachable without
  // scrolling the panel itself.
  maxHeight: "min(78vh, 620px)",
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

/**
 * A theme's palette at swatch size, read from the token map for the mode
 * currently on screen so the strip previews what selecting the row would
 * actually produce.
 *
 * Each swatch is the token colour drawn ON the theme's own background rather
 * than on the panel's. Several themes declare `border` as a translucent black
 * or white (Mono's is `oklch(0 0 0 / 0.445)`), which over a dark panel would
 * render as a barely-there smudge that says nothing about the theme -- and
 * over any fixed backdrop would show a colour the theme never produces.
 * Stacking it over the background composites it exactly the way the browser
 * composites it in the admin, without this file having to parse or blend
 * colours itself.
 */
function SwatchStrip({ tokens }: { tokens: ThemeTokens }) {
  return (
    <span style={{ display: "flex", gap: 3, flex: "0 0 auto", paddingTop: 1 }}>
      {SWATCH_TOKENS.map(token => (
        <span
          key={token}
          title={token}
          style={{
            display: "block",
            width: 13,
            height: 13,
            borderRadius: 3,
            overflow: "hidden",
            background: tokens.background,
            // Inset so the hairline that keeps a white swatch visible against
            // the panel does not eat into the colour being previewed.
            boxShadow: `inset 0 0 0 1px rgba(232, 232, 236, 0.25)`,
          }}
        >
          <span
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              background: tokens[token],
            }}
          />
        </span>
      ))}
    </span>
  );
}

function ThemeRow({
  theme,
  mode,
  selected,
  onSelect,
}: {
  theme: ThemeDefinition;
  mode: "light" | "dark";
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        display: "flex",
        gap: 8,
        width: "100%",
        textAlign: "left",
        alignItems: "flex-start",
        background: selected ? SELECTED_BG : "transparent",
        color: PANEL_FG,
        border: `1px solid ${selected ? SELECTED_BORDER : "transparent"}`,
        borderRadius: 4,
        padding: "5px 6px",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      <SwatchStrip tokens={mode === "dark" ? theme.dark : theme.light} />
      {/* minWidth:0 lets the description wrap inside the flex row instead of
          forcing the panel wider than its own width. */}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600 }}>{theme.label}</span>
        <span
          style={{
            display: "block",
            opacity: 0.68,
            fontSize: 11,
            marginTop: 1,
          }}
        >
          {theme.description}
        </span>
      </span>
    </button>
  );
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
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

  // Matches name and description together, so a search can be for what a
  // theme is called OR for what it does ("serif", "warm", "pill") -- the
  // latter being the only way to find something in the tweakcn half, whose
  // labels are brand names that describe nothing.
  const needle = filter.trim().toLowerCase();
  const groups = GROUPS.map(group => ({
    label: group.label,
    themes: needle
      ? group.themes.filter(t =>
          `${t.label} ${t.description}`.toLowerCase().includes(needle)
        )
      : group.themes,
  }));
  const matchCount = groups.reduce((sum, g) => sum + g.themes.length, 0);

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

      <input
        type="search"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="filter themes"
        aria-label="Filter themes"
        style={{ ...selectStyle, marginTop: 8, flex: "0 0 auto" }}
      />

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
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 4,
        }}
      >
        {matchCount === 0 && (
          <div style={{ padding: "8px 6px", opacity: 0.68 }}>no matches</div>
        )}
        {groups.map(group =>
          group.themes.length === 0 ? null : (
            <div key={group.label}>
              {/* Sticky so the group a row belongs to stays visible while
                  scrolling a list this long -- the distinction between a
                  Nextly original and a third-party preset is the one piece of
                  context a row can't carry on its own. */}
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
                    would take its background down with it, and the rows
                    scrolling underneath would read straight through it. */}
                <span style={{ opacity: 0.75 }}>
                  {group.label} ({group.themes.length})
                </span>
              </div>
              <div style={{ padding: 3 }}>
                {group.themes.map(t => (
                  <ThemeRow
                    key={t.id}
                    theme={t}
                    mode={mode}
                    selected={t.id === theme}
                    onSelect={() => setTheme(t.id)}
                  />
                ))}
              </div>
            </div>
          )
        )}
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

      <button
        type="button"
        onClick={reset}
        style={{ ...buttonStyle, marginTop: 10, flex: "0 0 auto" }}
      >
        reset
      </button>
    </div>
  );
}
