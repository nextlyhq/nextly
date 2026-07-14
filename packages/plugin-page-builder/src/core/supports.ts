/**
 * The `supports` capability model (spec §4.1). Isomorphic, React-free.
 *
 * A block declares which style capabilities it exposes; the inspector derives
 * grouped controls (`supportsToControls`) and the compiler derives CSS from the
 * same expanded `StyleValues`. `true` is shorthand for "all sub-flags on".
 */

export interface TypographySupport {
  fontFamily?: boolean;
  fontSize?: boolean;
  fontWeight?: boolean;
  lineHeight?: boolean;
  letterSpacing?: boolean;
  wordSpacing?: boolean;
  textTransform?: boolean;
  fontStyle?: boolean;
  textDecoration?: boolean;
  textAlign?: boolean;
  textShadow?: boolean;
}
export interface ColorSupport {
  text?: boolean;
  background?: boolean;
  gradient?: boolean;
  border?: boolean;
}
export interface BackgroundSupport {
  image?: boolean;
  gradient?: boolean;
}
export interface BorderSupport {
  width?: boolean;
  style?: boolean;
  color?: boolean;
  radius?: boolean;
}
export interface SpacingSupport {
  margin?: boolean;
  padding?: boolean;
  blockGap?: boolean;
}
export interface DimensionsSupport {
  width?: boolean;
  height?: boolean;
  minHeight?: boolean;
  maxWidth?: boolean;
  objectFit?: boolean;
  overflow?: boolean;
  aspectRatio?: boolean;
}
export interface InteractionsSupport {
  hover?: boolean;
  transition?: boolean;
}

export interface BlockSupports {
  spacing?: boolean | SpacingSupport;
  typography?: boolean | TypographySupport;
  color?: boolean | ColorSupport;
  background?: boolean | BackgroundSupport;
  border?: boolean | BorderSupport;
  shadow?: boolean;
  dimensions?: boolean | DimensionsSupport;
  position?: boolean;
  opacity?: boolean;
  filters?: boolean;
  motion?: boolean;
  visibility?: boolean;
  interactions?: boolean | InteractionsSupport;
  customCss?: boolean;
  customAttributes?: boolean;
}

/** Fully-expanded, no-shorthand form used by the mapper + inspector. */
export interface NormalizedSupports {
  spacing: SpacingSupport | false;
  typography: TypographySupport | false;
  color: ColorSupport | false;
  background: BackgroundSupport | false;
  border: BorderSupport | false;
  shadow: boolean;
  dimensions: DimensionsSupport | false;
  position: boolean;
  opacity: boolean;
  filters: boolean;
  motion: boolean;
  visibility: boolean;
  interactions: InteractionsSupport | false;
  customCss: boolean;
  customAttributes: boolean;
}

const TYPO_KEYS: (keyof TypographySupport)[] = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "fontStyle",
  "textDecoration",
  "textAlign",
  "textShadow",
];
const COLOR_KEYS: (keyof ColorSupport)[] = [
  "text",
  "background",
  "gradient",
  "border",
];
const BG_KEYS: (keyof BackgroundSupport)[] = ["image", "gradient"];
const BORDER_KEYS: (keyof BorderSupport)[] = [
  "width",
  "style",
  "color",
  "radius",
];
const SPACING_KEYS: (keyof SpacingSupport)[] = [
  "margin",
  "padding",
  "blockGap",
];
const DIM_KEYS: (keyof DimensionsSupport)[] = [
  "width",
  "height",
  "minHeight",
  "maxWidth",
  "objectFit",
  "overflow",
  "aspectRatio",
];
const INTERACT_KEYS: (keyof InteractionsSupport)[] = ["hover", "transition"];

function expand<T extends string>(
  v: boolean | object | undefined,
  keys: T[]
): Record<T, boolean> | false {
  if (!v) return false;
  const out = {} as Record<T, boolean>;
  const all = v === true;
  const rec = v as Record<string, unknown>;
  for (const k of keys) {
    out[k] = all ? true : Boolean(rec[k]);
  }
  return out;
}

export function normalizeSupports(s: BlockSupports = {}): NormalizedSupports {
  return {
    spacing: expand(s.spacing, SPACING_KEYS),
    typography: expand(s.typography, TYPO_KEYS),
    color: expand(s.color, COLOR_KEYS),
    background: expand(s.background, BG_KEYS),
    border: expand(s.border, BORDER_KEYS),
    shadow: Boolean(s.shadow),
    dimensions: expand(s.dimensions, DIM_KEYS),
    position: Boolean(s.position),
    opacity: Boolean(s.opacity),
    filters: Boolean(s.filters),
    motion: Boolean(s.motion),
    visibility: s.visibility !== false, // default ON
    interactions: expand(s.interactions, INTERACT_KEYS),
    customCss: s.customCss !== false, // default ON
    customAttributes: s.customAttributes !== false, // default ON
  };
}
