/**
 * Breakpoint-aware read/write over ResponsiveStyle (spec §8). Pure + immutable so the
 * inspector can drive edits and the reducer stays testable. Breakpoint keys are data
 * (project-configurable) — these helpers treat any string key generically.
 */
import type { ResponsiveStyle, StyleValues } from "./types";

/** Editor preview widths per breakpoint (px). "base" = full width (0 → 100%). */
export const BREAKPOINT_WIDTHS: Record<string, number> = {
  base: 0,
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
