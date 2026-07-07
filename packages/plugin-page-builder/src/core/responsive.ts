/**
 * Breakpoint-aware read/write over ResponsiveStyle (spec §8). Pure + immutable so the
 * inspector can drive edits and the reducer stays testable. Breakpoint keys are data
 * (project-configurable) — these helpers treat any string key generically.
 */
import type { ResponsiveStyle, StyleValues } from "./types";

/** Editor preview widths per breakpoint (px). "base" = full width (0 → 100%). */
/**
 * Editor preview widths per breakpoint (px). "base" is a fixed, representative desktop
 * width (not fluid) so the canvas is a faithful WYSIWYG: the editor renders content at a
 * definite width and the published page matches at that same width — width-dependent
 * layout (max-width, centering, %) can't be pixel-matched between a fluid page and a
 * narrower editor pane otherwise.
 */
export const BREAKPOINT_WIDTHS: Record<string, number> = {
  base: 1280,
  tablet: 768,
  mobile: 375,
};

export function readStyleValue(
  style: ResponsiveStyle | undefined,
  styleKey: string,
  breakpoint: string
): unknown {
  return style?.[breakpoint]?.[styleKey as keyof StyleValues];
}

/**
 * Return a new ResponsiveStyle with `styleKey` set (or removed, when value is
 * undefined/"") at `breakpoint`. Never mutates the input.
 */
export function writeStyleValue(
  style: ResponsiveStyle | undefined,
  styleKey: string,
  breakpoint: string,
  value: unknown
): ResponsiveStyle {
  const next: ResponsiveStyle = { ...(style ?? {}) };
  const layer: StyleValues = { ...(next[breakpoint] ?? {}) };
  if (value === undefined || value === "") {
    delete layer[styleKey as keyof StyleValues];
  } else {
    (layer as Record<string, unknown>)[styleKey] = value;
  }
  next[breakpoint] = layer;
  return next;
}
