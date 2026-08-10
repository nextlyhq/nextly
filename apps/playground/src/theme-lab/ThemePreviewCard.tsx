"use client";

/**
 * One theme rendered as itself: real admin primitives under that theme's
 * tokens, light and dark side by side.
 *
 * Tokens are applied INLINE as custom properties rather than through a
 * generated stylesheet. An inline declaration outranks any class-scoped one
 * and cannot leak past this subtree, so the card needs no CSS of its own and
 * therefore cannot drift from what `themeToCss` emits for the same
 * definition -- both read the same `ThemeDefinition` fields.
 *
 * The primitives shown are deliberately the ones themes have actually failed
 * on: nav rows (where a sidebar can misuse the primary colour), a checkbox
 * and an input (where a border can fall below visibility), buttons and a
 * badge. A swatch strip would show colours without showing whether they work.
 */
import { Badge, Button, Checkbox, Input } from "@nextlyhq/ui";
import type { CSSProperties } from "react";

import type { ThemeDefinition } from "./types";

/** `CSSProperties` widened to carry the custom properties a theme sets. */
export type CssVars = CSSProperties & Record<`--${string}`, string>;

/**
 * A theme's tokens for one mode, as inline custom properties.
 *
 * Names are prefixed here for the same reason `generate-css` prefixes them:
 * the definition stores bare token names, and `--nx-` is the admin's
 * vocabulary. The shell knobs (radius, fonts) sit outside the mode maps
 * because they do not vary between light and dark.
 */
export function themeVars(
  theme: ThemeDefinition,
  mode: "light" | "dark"
): CssVars {
  const vars: CssVars = {
    "--radius": theme.radius,
    "--font-sans": theme.fontSans,
    "--font-mono": theme.fontMono,
  };
  if (theme.fontSerif) vars["--font-serif"] = theme.fontSerif;
  for (const [name, value] of Object.entries(theme[mode])) {
    vars[`--nx-${name}`] = value;
  }
  return vars;
}

/** The component sampler one mode panel shows. */
function Sampler({ compact }: { compact: boolean }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {/* A sidebar strip in its three states: idle, selected, and muted --
          the selected row is where a theme's primary colour shows up as a
          nav background it was never meant to be. */}
      <div className="rounded-md border border-[var(--nx-sidebar-border)] bg-[var(--nx-sidebar-background)] p-1.5 text-[13px]">
        <div className="rounded px-2 py-1 text-[var(--nx-sidebar-foreground)]">
          Posts
        </div>
        <div className="rounded bg-[var(--nx-sidebar-accent)] px-2 py-1 text-[var(--nx-sidebar-accent-foreground)]">
          Pages
        </div>
        <div className="rounded px-2 py-1 text-[var(--nx-muted-foreground)]">
          Media
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm">Save</Button>
        <Button size="sm" variant="outline">
          Cancel
        </Button>
        <Badge>Draft</Badge>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox aria-label="Example checkbox" defaultChecked={false} />
        <Input placeholder="Title" className="h-8" />
      </div>

      {!compact && (
        <p className="text-xs text-[var(--nx-muted-foreground)]">
          Secondary text at its real size.
        </p>
      )}
    </div>
  );
}

export function ThemePreviewCard({
  theme,
  size,
  mode,
  contrastFailures,
  onApply,
  applied,
}: {
  theme: ThemeDefinition;
  size: "panel" | "gallery";
  /**
   * Render only this mode. The panel pins it to whatever the admin is
   * currently showing, because a card stacking both modes in a corner panel
   * is twice as tall as the thing it previews; the gallery has room and
   * shows both, which is where a mode is actually compared.
   */
  mode?: "light" | "dark";
  /**
   * Measured WCAG AA misses across this theme's asserted pairings.
   *
   * Passed in rather than read here, so the card stays a pure function of a
   * theme. Shown because the shortlist is chosen by eye and the cost of a
   * choice is invisible to the eye: every tweakcn preset in the lab misses AA
   * somewhere, and picking one without seeing the number is picking blind.
   */
  contrastFailures?: number;
  onApply: (id: string) => void;
  applied: boolean;
}) {
  const compact = size === "panel";
  const modes: readonly ("light" | "dark")[] =
    mode === undefined ? (["light", "dark"] as const) : [mode];

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--nx-border)]">
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{theme.label}</h3>
            {contrastFailures !== undefined && (
              <span
                data-testid="contrast-score"
                title={
                  contrastFailures === 0
                    ? "Passes every asserted WCAG AA pairing"
                    : `${contrastFailures} asserted pairings fall below WCAG AA`
                }
                className={
                  contrastFailures === 0
                    ? "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-success)]"
                    : "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-destructive)]"
                }
              >
                {contrastFailures === 0
                  ? "AA"
                  : `${contrastFailures} AA misses`}
              </span>
            )}
          </div>
          {!compact && (
            <p className="truncate text-xs text-[var(--nx-muted-foreground)]">
              {theme.description}
            </p>
          )}
        </div>
        {applied ? (
          <span className="shrink-0 text-xs font-medium">Active</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => onApply(theme.id)}
          >
            Apply
          </Button>
        )}
      </header>

      <div className={modes.length === 1 ? "grid" : "grid grid-cols-2"}>
        {modes.map(panelMode => (
          <div
            key={panelMode}
            data-testid="mode-panel"
            /* `nextly-admin` brings the ui components' base styles; `dark`
               is what their dark-mode variants key off. The inline vars then
               decide every token those styles read. */
            className={`nextly-admin ${panelMode === "dark" ? "dark" : ""}`}
            style={{
              ...themeVars(theme, panelMode),
              background: "var(--nx-page-background)",
              color: "var(--nx-foreground)",
            }}
          >
            <Sampler compact={compact} />
          </div>
        ))}
      </div>
    </section>
  );
}
