/**
 * The colours a stage can be shown in, as a fixed palette of swatches.
 *
 * The settings API stores a stage's colour as a hex value, and a stage defined
 * in code carries none. The admin never paints that value: each swatch is
 * drawn with a status token set from the theme (`--nx-<status>-surface` under
 * the label, `--nx-<status>-text` for the label, `--nx-<status>-solid` for the
 * dot), defined for light AND dark, so the label stays readable on its swatch
 * in both schemes. The hex is only the value a swatch is stored as.
 *
 * A stage with no colour is drawn neutral and named "No colour", never given a
 * guessed one. A stored value outside the palette (written through the API by
 * other code) is drawn neutral too, its own value shown only as a small dot.
 *
 * @module components/features/settings/workflows/stage-colours
 */

/** The theme status a swatch is drawn with. */
export type SwatchTone = "info" | "success" | "warning" | "danger";

/** One swatch of the palette. */
export interface StageSwatch {
  id: SwatchTone;
  /** How the picker names it. */
  name: string;
  /** The value the API stores for it, lower-case. */
  value: string;
  /** Its classes: surface and border, label, and dot, each a theme token. */
  surface: string;
  label: string;
  dot: string;
}

/**
 * The palette, in the picker's order. Each `value` is what the API stores for
 * that swatch; what is drawn is the tone's tokens, checked for contrast in
 * both schemes by `stage-colours.test.ts`.
 */
// design-lint-ok: the stored hex values the API keeps for each swatch, never painted.
export const STAGE_SWATCHES: readonly StageSwatch[] = [
  {
    id: "info",
    name: "Blue",
    value: "#2563eb",
    surface: "bg-info-surface border-info-border",
    label: "text-info-text",
    dot: "bg-info-solid",
  },
  {
    id: "success",
    name: "Green",
    value: "#16a34a",
    surface: "bg-success-surface border-success-border",
    label: "text-success-text",
    dot: "bg-success-solid",
  },
  {
    id: "warning",
    name: "Amber",
    value: "#d97706",
    surface: "bg-warning-surface border-warning-border",
    label: "text-warning-text",
    dot: "bg-warning-solid",
  },
  {
    id: "danger",
    name: "Red",
    value: "#dc2626",
    surface: "bg-danger-surface border-danger-border",
    label: "text-danger-text",
    dot: "bg-danger-solid",
  },
];

/** The neutral swatch: a stage with no colour, or one outside the palette. */
export const NEUTRAL_SWATCH = {
  name: "No colour",
  surface: "bg-muted border-border",
  label: "text-foreground",
  dot: "border border-muted-foreground bg-transparent",
} as const;

/** How a stored colour is drawn: a palette swatch, none, or a value outside it. */
export type StageColour =
  | { kind: "swatch"; swatch: StageSwatch }
  | { kind: "none" }
  | { kind: "custom"; value: string };

/** The swatch a stored colour is, compared without regard to case. */
export function stageColourOf(stored: string | undefined): StageColour {
  if (stored === undefined) return { kind: "none" };
  const swatch = STAGE_SWATCHES.find(
    each => each.value === stored.toLowerCase()
  );
  return swatch
    ? { kind: "swatch", swatch }
    : { kind: "custom", value: stored };
}
